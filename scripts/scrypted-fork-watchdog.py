#!/usr/bin/env python3
"""
Scrypted fork-spawn watchdog.

Tails `docker logs -f scrypted`, counts NVR fork spawns per camera, and
applies a token-bucket circuit breaker:

  * Per-camera: > PER_CAM_LIMIT spawns / WINDOW_S  -> warning + HA notify,
    log to JSONL.  (We do NOT auto-disable the mixin -- requires the
    Scrypted WebSocket API and the auth surface is fragile.  Operator
    decides whether to disable in the UI.)
  * Aggregate:  > AGG_LIMIT spawns / WINDOW_S      -> controlled
    `docker restart scrypted` with COOLDOWN_S between restarts.  Better
    than letting cgroup OOM cascade to the host and kill the HA VM.

All actions are emitted as JSON lines to /var/log/scrypted-watchdog.jsonl.
"""

import collections
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request

CONTAINER     = "scrypted"
WINDOW_S      = 60
PER_CAM_LIMIT = 30
AGG_LIMIT     = 150
COOLDOWN_S    = 300
LOG_PATH      = "/var/log/scrypted-watchdog.jsonl"

HA_URL   = "http://10.0.0.235:8123/api/services/persistent_notification/create"
HA_TOKEN = os.environ.get("HA_TOKEN", "").strip()

FORK_RE = re.compile(r"^\[(?P<cam>[^\]]+)\] starting fork @scrypted/nvr\b")

last_restart = 0.0
last_cam_warn: dict[str, float] = {}


def jlog(event: str, **kw) -> None:
    rec = {"ts": time.time(), "event": event, **kw}
    line = json.dumps(rec, ensure_ascii=False)
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def ha_notify(title: str, message: str) -> None:
    if not HA_TOKEN:
        return
    body = json.dumps({"title": title, "message": message,
                       "notification_id": "scrypted_watchdog"}).encode()
    req = urllib.request.Request(
        HA_URL, data=body,
        headers={"Authorization": f"Bearer {HA_TOKEN}",
                 "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=4).read()
    except Exception as e:
        jlog("ha_notify_failed", error=str(e))


def restart_container() -> None:
    global last_restart
    now = time.time()
    if now - last_restart < COOLDOWN_S:
        jlog("restart_skipped_cooldown",
             remaining=COOLDOWN_S - (now - last_restart))
        return
    last_restart = now
    jlog("restart_triggered")
    ha_notify("Scrypted watchdog",
              "Aggregate fork rate exceeded — restarting container.")
    subprocess.run(["docker", "restart", CONTAINER],
                   check=False, timeout=60)


def main() -> None:
    spawns: dict[str, collections.deque[float]] = collections.defaultdict(
        collections.deque)
    agg: collections.deque[float] = collections.deque()

    proc = subprocess.Popen(
        ["docker", "logs", "-f", "--tail", "0", CONTAINER],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1)

    jlog("started", per_cam_limit=PER_CAM_LIMIT, agg_limit=AGG_LIMIT,
         window_s=WINDOW_S, cooldown_s=COOLDOWN_S)

    def shutdown(*_):
        jlog("stopping")
        try:
            proc.terminate()
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    assert proc.stdout is not None
    for line in proc.stdout:
        m = FORK_RE.match(line)
        if not m:
            continue
        cam = m.group("cam")
        now = time.time()
        cutoff = now - WINDOW_S

        dq = spawns[cam]
        dq.append(now)
        while dq and dq[0] < cutoff:
            dq.popleft()

        agg.append(now)
        while agg and agg[0] < cutoff:
            agg.popleft()

        if len(dq) >= PER_CAM_LIMIT:
            last = last_cam_warn.get(cam, 0.0)
            if now - last >= WINDOW_S:
                last_cam_warn[cam] = now
                jlog("camera_storm", camera=cam,
                     spawns_window=len(dq), window_s=WINDOW_S)
                ha_notify("Scrypted watchdog",
                          f"Camera '{cam}': {len(dq)} forks in "
                          f"{WINDOW_S}s — review NVR mixins (likely "
                          f"missing license or bad stream).")

        if len(agg) >= AGG_LIMIT:
            jlog("aggregate_storm", spawns_window=len(agg),
                 window_s=WINDOW_S, by_camera={c: len(d)
                                               for c, d in spawns.items()
                                               if d})
            restart_container()
            spawns.clear()
            agg.clear()


if __name__ == "__main__":
    main()
