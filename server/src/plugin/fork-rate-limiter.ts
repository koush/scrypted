/**
 * Generic fork-spawn rate limiter with exponential backoff.
 * 
 * Prevents plugins from spawning excessive child processes that can
 * exhaust system resources and trigger OOM conditions.
 */

export interface ForkRateLimiterOptions {
    /** Maximum forks per window before triggering circuit breaker */
    maxForksPerWindow?: number;
    /** Time window in milliseconds */
    windowMs?: number;
    /** Enable exponential backoff on rapid failures */
    enableBackoff?: boolean;
    /** Maximum backoff delay in milliseconds */
    maxBackoffMs?: number;
}

interface ForkAttempt {
    timestamp: number;
    success: boolean;
}

export class ForkRateLimiter {
    private attempts: Map<string, ForkAttempt[]> = new Map();
    private backoffDelay: Map<string, number> = new Map();
    private options: Required<ForkRateLimiterOptions>;

    constructor(options: ForkRateLimiterOptions = {}) {
        this.options = {
            maxForksPerWindow: options.maxForksPerWindow ?? 30,
            windowMs: options.windowMs ?? 60000,
            enableBackoff: options.enableBackoff ?? true,
            maxBackoffMs: options.maxBackoffMs ?? 60000,
        };
    }

    /**
     * Check if a fork spawn is allowed for the given key (e.g., pluginId or pluginId:cameraId).
     * Returns { allowed: false, delayMs } if rate limit exceeded.
     */
    checkAllowed(key: string): { allowed: boolean; delayMs?: number; reason?: string } {
        const now = Date.now();
        const cutoff = now - this.options.windowMs;

        // Clean old attempts
        const history = this.attempts.get(key) || [];
        const recentAttempts = history.filter(a => a.timestamp >= cutoff);
        this.attempts.set(key, recentAttempts);

        // Check rate limit
        if (recentAttempts.length >= this.options.maxForksPerWindow) {
            const oldestInWindow = recentAttempts[0].timestamp;
            const delayMs = oldestInWindow + this.options.windowMs - now;
            return {
                allowed: false,
                delayMs: Math.max(0, delayMs),
                reason: `Fork rate limit exceeded: ${recentAttempts.length} forks in ${this.options.windowMs}ms`,
            };
        }

        // Check backoff
        if (this.options.enableBackoff) {
            const backoff = this.backoffDelay.get(key) || 0;
            if (backoff > 0) {
                return {
                    allowed: false,
                    delayMs: backoff,
                    reason: `Fork backoff active: ${backoff}ms remaining`,
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Record a fork attempt.
     * @param success - Whether the fork succeeded (lived longer than a threshold, e.g., 10s)
     */
    recordAttempt(key: string, success: boolean): void {
        const now = Date.now();
        const history = this.attempts.get(key) || [];
        history.push({ timestamp: now, success });
        this.attempts.set(key, history);

        // Update backoff on failure
        if (!success && this.options.enableBackoff) {
            const currentBackoff = this.backoffDelay.get(key) || 0;
            const newBackoff = Math.min(
                (currentBackoff || 500) * 2,
                this.options.maxBackoffMs
            );
            this.backoffDelay.set(key, newBackoff);

            // Clear backoff after delay
            setTimeout(() => {
                this.backoffDelay.delete(key);
            }, newBackoff);
        } else if (success) {
            // Reset backoff on success
            this.backoffDelay.delete(key);
        }
    }

    /**
     * Get current statistics for a key.
     */
    getStats(key: string): { recentAttempts: number; backoffMs: number } {
        const now = Date.now();
        const cutoff = now - this.options.windowMs;
        const history = this.attempts.get(key) || [];
        const recentAttempts = history.filter(a => a.timestamp >= cutoff).length;
        const backoffMs = this.backoffDelay.get(key) || 0;
        return { recentAttempts, backoffMs };
    }

    /**
     * Clear all state for a key (e.g., when plugin is reloaded).
     */
    reset(key: string): void {
        this.attempts.delete(key);
        this.backoffDelay.delete(key);
    }

    /**
     * Clear all state.
     */
    resetAll(): void {
        this.attempts.clear();
        this.backoffDelay.clear();
    }
}

// Global instance for server-wide rate limiting
export const globalForkRateLimiter = new ForkRateLimiter({
    maxForksPerWindow: parseInt(process.env.SCRYPTED_MAX_FORKS_PER_WINDOW || '150'),
    windowMs: parseInt(process.env.SCRYPTED_FORK_WINDOW_MS || '60000'),
    enableBackoff: process.env.SCRYPTED_FORK_BACKOFF !== 'false',
    maxBackoffMs: parseInt(process.env.SCRYPTED_MAX_FORK_BACKOFF_MS || '60000'),
});
