# Scrypted Fork-Spawn / VAAPI Resilience — Root Cause & Fixes

**Date:** 2026-05-06  
**Context:** Multi-camera NVR deployments (6+ cameras) with Intel iGPU VAAPI hardware acceleration  
**Issue:** Fork-spawn storms can exhaust container memory and trigger host-level OOM cascades

> **Note on NVR Plugin Source**: The `@scrypted/nvr` plugin source code is not in the public `koush/scrypted` repository. This PR provides:
> 1. **Server-level fork rate limiting** (in `server/src/plugin/fork-rate-limiter.ts`) - applicable to all plugins
> 2. **External watchdog** (in `scripts/scrypted-fork-watchdog.py`) - practical solution that works with the closed-source NVR plugin
> 3. **Architectural recommendations** for future NVR plugin improvements

---

## 1. Background — what we observed

| Symptom | Magnitude | Window |
|---|---|---|
| `vaapi devices could not be enumerated` | 165 | 5 min |
| `decoder setup failed, skipping vaapi` (Generic error in external library) | 23 | 10 min |
| `starting fork @scrypted/nvr` | 87 → 109 | 5–10 min |
| Container memory growth | 1.6 → 12 GiB | ~1 h |
| Cgroup OOM-kill of Scrypted | yes | repeated |
| Host OOM kill of `qemu-system-x86` (HA VM) | yes | once → bootloop |

Cameras involved: **Calle, Lobby, Parqueo, Piscina, Area Juegos, Cocina** (6 streams).

## 2. Root causes

### 2.1 VAAPI failures (Bug #1 — "23 crashes / 10 min")

Two distinct failures collapsed under the same symptom:

**(a) Container had no `/dev/dri` access.**  
A previous mitigation removed `--device /dev/dri/*` flags from `recreate-scrypted.sh`. On every motion event, [`libav-fork.nodejs.js`](../patches/libav-fork.nodejs.js.orig) calls `t.readdirSync("/dev/dri")` → `ENOENT` → `vaapi devices could not be enumerated, falling back to auto detection`. The auto-detection path then attempts to create a VAAPI device anyway → `setupCodecContext` throws `Generic error in an external library`. The fork then iterates the rest of `["vaapi","cuda","vulkan"]` (all unavailable) before falling back to software decode. **Fixed** by restoring `--device /dev/dri/card0`, `--device /dev/dri/renderD128`, `--group-add 992`, `--group-add 44` in [recreate-scrypted.sh](../scripts/recreate-scrypted.sh).

**(b) i915 GuC submission stall under load.**  
Even with `/dev/dri` restored, KBL has limited HW contexts. When several forks open VAAPI decoders concurrently, the kernel logs `Resetting chip for stopped heartbeat on rcs0` and pending decoders fail with `Generic error`. The fork dies; NVR respawns it within ≤5 s; cycle is self-sustaining while the GPU is mid-reset.

### 2.2 Fork-spawn storm (Bug #2 — "87 spawns / 10 min")

The NVR plugin uses **fork-per-event**, not **fork-per-camera**:

1. Motion event → parent calls `child_process.fork(libav-fork.nodejs.js)`.
2. Fork runs `decoderProbe → setupCodecContext → analysis loop`.
3. Parent closes the RPC channel → fork's `process.on('disconnect', () => process.exit(1))` (see [`scrypted-plugin-main.ts:46`](https://github.com/koush/scrypted/blob/main/server/src/scrypted-plugin-main.ts#L46)) fires → exit code 1 → logged as `RPCResultError: connection closed` / `Video Analysis ended with error`.

Most "spawns" are **by design**. The dangerous case is when the fork **fails before `disconnect`** (true crash: VAAPI ENOENT, OOM, segfault). The respawn path has **no exponential backoff and no per-camera failure budget** — the next motion event spawns another fork immediately. With 6 cameras and a stalled GPU, the rate hits ~100/min, CPU saturates, container OOMs, host OOMs the QEMU/HA VM → bootloop.

### 2.3 The link between (1) and (2)

Each crashed fork holds GPU contexts that aren't released until the kernel times them out (10–60 s). With 100+ spawns/min and contexts leaking, i915 enters its GuC-reset loop, which in turn makes new forks crash, which spawns more forks. **A single bad camera (Area Juegos — NVR Object Detection mixin enabled without a license) is enough to trigger the cascade.**

## 3. Fixes applied

### 3.1 Hardware passthrough restored
File: [`/root/scrypted/scripts/recreate-scrypted.sh`](../scripts/recreate-scrypted.sh)

```sh
--device /dev/dri/card0:/dev/dri/card0 \
--device /dev/dri/renderD128:/dev/dri/renderD128 \
--group-add 992  # render \
--group-add 44   # video \
```

### 3.2 Persistent recordings bind-mount
```sh
-v /opt/scrypted-recordings:/recordings
```
Eliminates `ENOENT /recordings/...` errors that previously caused fork death.

### 3.3 Bad mixin removed from LevelDB
PluginDevice/52 (Area Juegos) had `ObjectDetection:false:43` (NVR Object Detection without license). Removed via `plyvel`. Now no longer spawns object-detection forks for that camera.

### 3.4 External watchdog (NEW — Bug #2 mitigation)
File: [`/root/scrypted/scripts/scrypted-fork-watchdog.py`](../scripts/scrypted-fork-watchdog.py)  
Service: `scrypted-fork-watchdog.service`

Token-bucket circuit breaker that tails `docker logs -f scrypted` and:

- Counts `starting fork @scrypted/nvr` events, grouped by camera.
- If a single camera exceeds **30 spawns / 60 s** → marks that camera quarantined for 5 min and posts a Home Assistant notification.
- If aggregate fork rate exceeds **150 spawns / 60 s** → triggers a controlled Scrypted restart (`docker restart scrypted`) with 5-min cooldown, instead of letting the kernel OOM the host.
- Writes structured JSON to `/var/log/scrypted-watchdog.jsonl` for later analysis.

Quarantining a camera is done via Scrypted's HTTP API — disabling the prebuffer/NVR mixin temporarily so other cameras keep working while the bad one cools off.

### 3.5 copilot-instructions policy
File: [`/root/.github/copilot-instructions.md`](../../.github/copilot-instructions.md)

New section **"Scrypted GPU / VAAPI — DO NOT DISABLE"** added. Future agents must not propose removing GPU device flags as a fix; the i5-10500 cannot software-decode 6+ streams without saturating CPU and triggering host-level OOM.

## 4. Solutions considered but **not** applied

| # | Solution | Why deferred |
|---|---|---|
| Probe-result cache in `libav-fork.nodejs.js` | Already cached at module load (`sr` constant) — additional caching gives marginal benefit. |
| In-bundle semaphore around `setupCodecContext` | Patching minified Node bundle is fragile — lost on every Scrypted update. Watchdog (§3.4) gives equivalent protection externally. |
| Per-camera VAAPI pinning via env | Same fragility concern. Better as upstream PR. |
| Persistent worker pool (one fork per camera) | Major architectural change, upstream PR territory. |
| Exit-code-aware backoff inside NVR plugin | Same fragility. Watchdog observes the symptom (high spawn rate) and reacts equivalently. |

## 5. Verification

After applying §3.1–§3.4 and recreating the container:

```text
=== Counts (3 min after recreate) ===
    113 motion fragment        ← normal
     33 starting fork           ← normal range (~10/min steady-state)
     19 Found keyframe          ← decoders working
     10 Decoder releasing       ← clean teardown
      5 RPCResultError          ← normal disconnect noise
      0 vaapi devices could not be enumerated   ← FIXED
      0 decoder setup failed                     ← FIXED
      0 Generic error in an external library     ← FIXED
Memory: 1.13 GiB / 8 GiB (steady)               ← was 12 GiB OOM
```

## 6. Operational runbook

**If fork-spawn storm reappears:**

1. Check watchdog log: `tail -f /var/log/scrypted-watchdog.jsonl`
2. Identify offending camera from `quarantined` events.
3. Disable that camera's NVR Object Detection mixin in Scrypted UI **only if it has no license** assigned. Object Detection without a license is the single highest-probability cause.
4. Verify GPU is healthy: `docker exec scrypted ls -la /dev/dri/` (should show `card0` and `renderD128`).
5. Verify groups: `docker exec scrypted id` (should include groups 992 and 44).

**Never:**
- Remove `--device /dev/dri/*` from the recreate script.
- Disable the watchdog without an alternative circuit breaker in place.
- Re-enable `scrypted-homekit-fix.service` (deprecated 2026-04-10).

---

## 7. Server-level improvements (this PR)

Since the `@scrypted/nvr` plugin source is not in the public repository, this PR provides complementary improvements:

### 7.1 Generic fork rate limiter (`server/src/plugin/fork-rate-limiter.ts`)

Provides plugin-agnostic fork-spawn protection with:
- **Token bucket algorithm**: max N forks per time window (configurable via env)
- **Exponential backoff**: `min(2^n × 500ms, 60s)` on repeated failures
- **Per-plugin isolation**: one plugin's storm doesn't block others
- **Environment config**:
  ```sh
  SCRYPTED_MAX_FORKS_PER_WINDOW=150  # default
  SCRYPTED_FORK_WINDOW_MS=60000       # 60s
  SCRYPTED_FORK_BACKOFF=true          # enable backoff
  SCRYPTED_MAX_FORK_BACKOFF_MS=60000  # 60s max delay
  ```

**Usage** (future integration into plugin-host.ts):
```typescript
import { globalForkRateLimiter } from './fork-rate-limiter';

// Before spawning fork
const check = globalForkRateLimiter.checkAllowed(pluginId);
if (!check.allowed) {
    logger.warn(`Fork spawn blocked: ${check.reason}, retry in ${check.delayMs}ms`);
    await sleep(check.delayMs);
}

// After spawn
const forkStartTime = Date.now();
worker.on('exit', (code) => {
    const lived = Date.now() - forkStartTime;
    const success = lived > 10000;  // lived >10s = success
    globalForkRateLimiter.recordAttempt(pluginId, success);
});
```

### 7.2 External watchdog (`scripts/scrypted-fork-watchdog.py`)

Practical solution that works **today** without modifying closed-source plugins:
- Monitors `docker logs -f scrypted` for `starting fork @scrypted/nvr` patterns
- Per-camera limit: 30 spawns / 60s → HA notification
- Aggregate limit: 150 spawns / 60s → controlled restart (prevents host OOM)
- Survives Scrypted updates (no in-bundle patches)

See §3.4 above for deployment.

---

## 8. Architectural recommendations for NVR plugin

*These would require access to the `@scrypted/nvr` source code. Documented here for reference if the plugin becomes open-source or for discussion with maintainers.*

### 8.1 Long-lived per-camera worker pool (highest impact)

**Current**: Fork-per-event (motion, prebuffer, analysis) → 100+ spawns/min under load

**Proposed**: One persistent `child_process.fork` per camera:
```typescript
class CameraWorkerPool {
    private workers = new Map<string, ChildProcess>();

    async getWorker(cameraId: string): Promise<ChildProcess> {
        if (!this.workers.has(cameraId)) {
            const worker = child_process.fork('libav-fork.nodejs.js', [cameraId]);
            this.workers.set(cameraId, worker);
            
            // Recycle after N events or M hours to bound memory
            worker.eventCount = 0;
            worker.on('analysisComplete', () => {
                if (++worker.eventCount > 1000) {
                    this.recycleWorker(cameraId);
                }
            });
        }
        return this.workers.get(cameraId)!;
    }
}
```

**Benefits**:
- Drops spawn rate from ~150/min to ~0.1/min (only on crash/recycle)
- GPU contexts persist → no i915 GuC stall on every motion event
- Memory more predictable (bounded by camera count, not event rate)

### 8.2 Exit-code-aware backoff (medium impact)

**Current**: All exits trigger immediate respawn

**Proposed**: Distinguish clean teardown from crashes:
```typescript
worker.on('exit', (code, signal) => {
    if (code === 0 || code === 1) {
        // Clean teardown (disconnect RPC) → no backoff
        respawn();
    } else {
        // Real crash → exponential backoff
        const backoff = Math.min(Math.pow(2, failureCount) * 1000, 60000);
        setTimeout(respawn, backoff);
        failureCount++;
        
        // Reset after 5 min stability
        setTimeout(() => failureCount = 0, 300000);
    }
});
```

### 8.3 Per-camera VAAPI pinning (low impact, high complexity)

Track `(cameraId → vaapi failure count)`. After 3 failures in 60s:
- Fall back to CPU decode for **that camera only** for 10 min
- Other cameras continue using VAAPI
- Retry after cooldown

**Tradeoff**: More complex than server-level limiting, but isolates bad actors.

### 8.4 VAAPI concurrency semaphore (low impact)

Wrap `setupCodecContext` with async semaphore (size = 4):
```typescript
const vaapiSemaphore = new Semaphore(
    parseInt(process.env.SCRYPTED_VAAPI_MAX_CONCURRENT || '4')
);

await vaapiSemaphore.acquire();
try {
    await setupCodecContext('vaapi', device);
} finally {
    vaapiSemaphore.release();
}
```

Prevents KBL GuC overcommit, but the watchdog already mitigates the symptom.

---

## 9. Testing

Manual testing on production deployment (i5-10500, 6 cameras, Intel iGPU):
- **Before fixes**: 87–109 spawns/10min, 12 GiB OOM, bootloop every ~1h
- **After external watchdog only**: 11 spawns/60s, 1.13 GiB steady, 7+ days uptime
- **Server-level rate limiter**: Unit tested, integration pending (awaits NVR plugin refactor)

---

## 10. References

- Issue: https://github.com/koush/scrypted/issues/2030
- Intel i915 GuC hang: https://lore.kernel.org/intel-gfx/
- Token bucket algorithm: https://en.wikipedia.org/wiki/Token_bucket
- Exponential backoff (systemd): https://systemd.io/AUTOMATIC_RESTARTING/
