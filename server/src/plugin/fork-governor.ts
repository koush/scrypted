/**
 * ForkGovernor — per-plugin fork-spawn rate limiter, exponential-backoff,
 * and crash-aware circuit breaker for `scrypted.fork()`.
 *
 * Motivation
 * ----------
 * Plugins like @scrypted/nvr can call `sdk.fork()` very frequently — once per
 * motion event per camera per pipeline (recording, detection, snapshots).
 * If a plugin's fork crashes immediately on startup (e.g. ENOENT writing event
 * JSON, GuC submission failure on iGPU, OOM) the consumer typically respawns
 * right away. A handful of misbehaving cameras can therefore spawn hundreds of
 * doomed child processes per minute, exhausting CPU, GPU contexts, FDs, and
 * memory until the entire container falls over (host-level OOM killer, i915
 * GuC reset cascades, etc.).
 *
 * This was the failure mode that motivated the external watchdog in
 * https://github.com/koush/scrypted/pull/2031, which Koush correctly closed
 * with "needs a proper fix in nvr". The proper fix is here, in core: enforce
 * back-pressure on the SDK fork API itself, so every plugin (including
 * closed-source ones like NVR) gets resilience for free.
 *
 * Algorithm
 * ---------
 * Per `(plugin, key)` — where `key` is `options.id` (usually a camera/device
 * id) or `options.name`, falling back to the literal string "default" — we
 * maintain:
 *
 *   - `attempts[]`  : timestamps of recent fork() calls (sliding window)
 *   - `crashes[]`   : timestamps of recent abnormal exits (exit code != 0
 *                     OR exit within `crashWindowMs` of spawn)
 *
 * On `beforeFork(key)`:
 *   1. Prune both arrays to the configured `windowMs`.
 *   2. If `crashes.length >= hardCrashLimit` AND `attempts.length >= hardLimit`,
 *      reject the fork immediately. The plugin gets a clear error and stops
 *      hammering. (NVR's existing `.catch()` then makes the host stable.)
 *   3. Compute backoff = `min(maxBackoffMs, minBackoffMs * 2^(crashes.length))`,
 *      with ±20% jitter. Sleep that long.
 *   4. Record the attempt timestamp.
 *
 * `registerSpawn(key)` returns an `onExit(code, signal)` callback the caller
 * uses to report the worker's terminal state. If the worker died abnormally
 * (non-zero exit, killed by signal, or exited within `crashWindowMs`) we add
 * to `crashes[]`. If it lived past `stableRunMs`, we *clear* that key's crash
 * counter — successful long-lived workers should not be penalized for old
 * failures.
 *
 * Tunables (env vars, all optional):
 *   SCRYPTED_FORK_GOVERNOR_DISABLE=1         disables the governor entirely
 *   SCRYPTED_FORK_GOVERNOR_WINDOW_MS         default 60000
 *   SCRYPTED_FORK_GOVERNOR_SOFT_LIMIT        default 30   (forks/window)
 *   SCRYPTED_FORK_GOVERNOR_HARD_LIMIT        default 90   (forks/window → reject)
 *   SCRYPTED_FORK_GOVERNOR_HARD_CRASH_LIMIT  default 10   (crashes/window → reject)
 *   SCRYPTED_FORK_GOVERNOR_MIN_BACKOFF_MS    default 250
 *   SCRYPTED_FORK_GOVERNOR_MAX_BACKOFF_MS    default 30000
 *   SCRYPTED_FORK_GOVERNOR_CRASH_WINDOW_MS   default 5000  (early exit = crash)
 *   SCRYPTED_FORK_GOVERNOR_STABLE_RUN_MS     default 60000 (clears crashes)
 */

function envInt(name: string, fallback: number): number {
    const v = process.env[name];
    if (!v)
        return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface ForkGovernorOptions {
    pluginId: string;
    windowMs?: number;
    softLimit?: number;
    hardLimit?: number;
    hardCrashLimit?: number;
    minBackoffMs?: number;
    maxBackoffMs?: number;
    crashWindowMs?: number;
    stableRunMs?: number;
    disabled?: boolean;
    log?: (msg: string) => void;
}

interface KeyState {
    attempts: number[];   // ms timestamps of recent spawn attempts
    crashes: number[];    // ms timestamps of recent abnormal exits
    sleepUntil: number;   // hint to coalesce: if we are already sleeping, future calls wait at least this long
}

export class ForkGovernorRejected extends Error {
    constructor(message: string, public readonly key: string, public readonly attempts: number, public readonly crashes: number) {
        super(message);
        this.name = 'ForkGovernorRejected';
    }
}

export class ForkGovernor {
    readonly pluginId: string;
    readonly windowMs: number;
    readonly softLimit: number;
    readonly hardLimit: number;
    readonly hardCrashLimit: number;
    readonly minBackoffMs: number;
    readonly maxBackoffMs: number;
    readonly crashWindowMs: number;
    readonly stableRunMs: number;
    readonly disabled: boolean;
    readonly log: (msg: string) => void;

    private state = new Map<string, KeyState>();

    constructor(opts: ForkGovernorOptions) {
        this.pluginId = opts.pluginId;
        this.disabled = opts.disabled ?? !!process.env.SCRYPTED_FORK_GOVERNOR_DISABLE;
        this.windowMs = opts.windowMs ?? envInt('SCRYPTED_FORK_GOVERNOR_WINDOW_MS', 60_000);
        this.softLimit = opts.softLimit ?? envInt('SCRYPTED_FORK_GOVERNOR_SOFT_LIMIT', 30);
        this.hardLimit = opts.hardLimit ?? envInt('SCRYPTED_FORK_GOVERNOR_HARD_LIMIT', 90);
        this.hardCrashLimit = opts.hardCrashLimit ?? envInt('SCRYPTED_FORK_GOVERNOR_HARD_CRASH_LIMIT', 10);
        this.minBackoffMs = opts.minBackoffMs ?? envInt('SCRYPTED_FORK_GOVERNOR_MIN_BACKOFF_MS', 250);
        this.maxBackoffMs = opts.maxBackoffMs ?? envInt('SCRYPTED_FORK_GOVERNOR_MAX_BACKOFF_MS', 30_000);
        this.crashWindowMs = opts.crashWindowMs ?? envInt('SCRYPTED_FORK_GOVERNOR_CRASH_WINDOW_MS', 5_000);
        this.stableRunMs = opts.stableRunMs ?? envInt('SCRYPTED_FORK_GOVERNOR_STABLE_RUN_MS', 60_000);
        this.log = opts.log ?? ((msg) => console.warn(`[fork-governor:${this.pluginId}]`, msg));
    }

    /**
     * Resolve the throttling key for a fork attempt. Prefers `options.id`
     * (typically the device id), then `options.name`, then "default".
     */
    static resolveKey(options: { id?: string; name?: string } | undefined): string {
        return options?.id || options?.name || 'default';
    }

    private getState(key: string): KeyState {
        let s = this.state.get(key);
        if (!s) {
            s = { attempts: [], crashes: [], sleepUntil: 0 };
            this.state.set(key, s);
        }
        return s;
    }

    private prune(arr: number[], cutoff: number): void {
        // arrays are append-only ascending — drop leading entries older than cutoff
        let i = 0;
        while (i < arr.length && (arr[i] as number) < cutoff) i++;
        if (i > 0)
            arr.splice(0, i);
    }

    private computeBackoffMs(crashCount: number): number {
        if (crashCount <= 0)
            return 0;
        // Exponential: min * 2^(crashes-1), capped at max
        const raw = this.minBackoffMs * Math.pow(2, Math.min(crashCount - 1, 20));
        const capped = Math.min(this.maxBackoffMs, raw);
        // ±20% jitter to avoid synchronized retries
        const jitter = capped * (0.8 + Math.random() * 0.4);
        return Math.round(jitter);
    }

    /**
     * Call before invoking the underlying runtime worker spawn. May `await` to
     * delay the spawn (backoff) or throw `ForkGovernorRejected` to abort it.
     */
    async beforeFork(key: string): Promise<void> {
        if (this.disabled)
            return;

        const now = Date.now();
        const s = this.getState(key);
        this.prune(s.attempts, now - this.windowMs);
        this.prune(s.crashes, now - this.windowMs);

        // Hard rejection: too many forks AND too many crashes in window
        if (s.attempts.length >= this.hardLimit && s.crashes.length >= this.hardCrashLimit) {
            this.log(`hard-rejecting fork for "${key}" (${s.attempts.length} attempts, ${s.crashes.length} crashes in ${this.windowMs}ms)`);
            throw new ForkGovernorRejected(
                `scrypted.fork() rejected by ForkGovernor: plugin "${this.pluginId}" key "${key}" hit ${s.attempts.length} attempts and ${s.crashes.length} crashes in the last ${Math.round(this.windowMs / 1000)}s. The fork target is in a crash loop; suspending new forks until the situation stabilizes.`,
                key,
                s.attempts.length,
                s.crashes.length,
            );
        }

        // Compute backoff based on crash count — soft limit is informational (logged once per window)
        let backoff = this.computeBackoffMs(s.crashes.length);

        // If a previous concurrent caller scheduled a sleep, respect it
        const remaining = s.sleepUntil - now;
        if (remaining > backoff)
            backoff = remaining;

        if (backoff > 0) {
            s.sleepUntil = now + backoff;
            this.log(`backing off ${backoff}ms before fork for "${key}" (${s.crashes.length} crashes, ${s.attempts.length} attempts in window)`);
            await new Promise(r => setTimeout(r, backoff));
        }
        else if (s.attempts.length >= this.softLimit) {
            // emit a soft warning every ~softLimit attempts, no delay
            if (s.attempts.length === this.softLimit)
                this.log(`soft limit reached for "${key}" (${s.attempts.length}/${this.windowMs}ms) — monitor for crashes`);
        }

        s.attempts.push(Date.now());
    }

    /**
     * Call right after spawning the worker. Returns a handle to report the
     * worker's exit so the governor can update its crash record.
     */
    registerSpawn(key: string): { onExit: (exitCode: number | null, signal: NodeJS.Signals | null) => void; spawnedAt: number } {
        const spawnedAt = Date.now();
        let reported = false;

        return {
            spawnedAt,
            onExit: (exitCode, signal) => {
                if (this.disabled || reported)
                    return;
                reported = true;
                const now = Date.now();
                const lifeMs = now - spawnedAt;
                const s = this.getState(key);

                const abnormal = signal != null
                    || (exitCode !== 0 && exitCode != null)
                    || lifeMs < this.crashWindowMs;

                if (abnormal) {
                    s.crashes.push(now);
                    this.prune(s.crashes, now - this.windowMs);
                }
                else if (lifeMs >= this.stableRunMs) {
                    // long-lived clean exit — wipe the crash counter
                    if (s.crashes.length) {
                        this.log(`stable run completed for "${key}" (${Math.round(lifeMs / 1000)}s) — clearing ${s.crashes.length} stale crashes`);
                        s.crashes.length = 0;
                    }
                }
            },
        };
    }

    /** For diagnostics / tests. */
    snapshot(): { key: string; attempts: number; crashes: number }[] {
        const now = Date.now();
        const out: { key: string; attempts: number; crashes: number }[] = [];
        for (const [key, s] of this.state) {
            this.prune(s.attempts, now - this.windowMs);
            this.prune(s.crashes, now - this.windowMs);
            if (s.attempts.length || s.crashes.length)
                out.push({ key, attempts: s.attempts.length, crashes: s.crashes.length });
        }
        return out;
    }
}
