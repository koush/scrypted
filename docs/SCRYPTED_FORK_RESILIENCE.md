# Scrypted Fork-Spawn / VAAPI Resilience — Root Cause & Fixes

**Date:** 2026-05-06  
**Host:** debian @ 10.0.0.111 (i5-10500, 6C/12T, 16 GB RAM, Intel iGPU i915 KBL)  
**Affected container:** `scrypted` (host networking, 8 GiB cap, GPU passthrough)

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
