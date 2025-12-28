from __future__ import annotations

import asyncio
import base64
import concurrent.futures
import json
import os
import platform
import struct
import sys
import threading
import time
import traceback
import socket
import urllib
import urllib.parse
import urllib.request
from ctypes import c_int
from typing import Any, Coroutine, Dict, List

import uuid

import scrypted_sdk
from requests import HTTPError, RequestException
from scrypted_sdk.other import MediaObject
from scrypted_sdk.types import (DeviceProvider, HttpRequestHandler, PanTiltZoom,
                                RequestMediaStreamOptions,
                                ResponseMediaStreamOptions, ScryptedDeviceType,
                                ScryptedInterface, Setting, Settings,
                                VideoCamera)

import wyzecam
import wyzecam.api_models
from wyzecam import tutk_protocol
from wyzecam.api import RateLimitError, post_device
from wyzecam.tutk.tutk import FRAME_SIZE_2K, FRAME_SIZE_360P, FRAME_SIZE_1080P

os.environ["TUTK_PROJECT_ROOT"] = os.path.join(
    os.environ["SCRYPTED_PLUGIN_VOLUME"], "zip/unzipped/fs"
)
sdkKey = "AQAAAIZ44fijz5pURQiNw4xpEfV9ZysFH8LYBPDxiONQlbLKaDeb7n26TSOPSGHftbRVo25k3uz5of06iGNB4pSfmvsCvm/tTlmML6HKS0vVxZnzEuK95TPGEGt+aE15m6fjtRXQKnUav59VSRHwRj9Z1Kjm1ClfkSPUF5NfUvsb3IAbai0WlzZE1yYCtks7NFRMbTXUMq3bFtNhEERD/7oc504b"

toThreadExecutor = concurrent.futures.ThreadPoolExecutor(thread_name_prefix="probe")

codecMap = {
    "mulaw": "PCMU",
    "alaw": "PCMA",
    "s16be": "L16",
    "opus": "OPUS",
    "aac": "MP4A-LATM",
}


def print_exception(print, e):
    for line in traceback.format_exception(e):
        print(line)


def format_exception(e):
    return "\n".join(traceback.format_exception(e))


def _normalize_cruise_points(points):
    """Normalize a raw cruise-point list into 0..40 (vertical) / 0..350 (horizontal) units."""
    if not points:
        return []

    out = []
    for p in points:
        try:
            if not isinstance(p, dict):
                continue
            raw_v = p.get("vertical", p.get("tilt", 0) or 0)
            raw_h = p.get("horizontal", p.get("pan", 0) or 0)
            raw_t = p.get("time", p.get("duration", 10) or 10)
            v_in = int(raw_v)
            h_in = int(raw_h)
            t = int(raw_t)

            if v_in > 40:
                v_deg = max(0, min(180, v_in))
                v = round(v_deg / 180.0 * 40.0)
            else:
                v = v_in

            if h_in > 350:
                h_deg = max(0, min(360, h_in))
                h = round(h_deg / 360.0 * 350.0)
            else:
                h = h_in

            v = max(0, min(40, int(v)))
            h = max(0, min(350, int(h)))
            t = max(1, min(255, int(t)))
            out.append({"vertical": v, "horizontal": h, "time": t})
        except Exception:
            continue

    return out


def _vertical_to_degrees(v: int) -> int:
    try:
        return round(max(0, min(40, int(v))) / 40.0 * 180)
    except Exception:
        return 0


def _horizontal_to_degrees(h: int) -> int:
    try:
        return round(max(0, min(350, int(h))) / 350.0 * 360)
    except Exception:
        return 0


def _annotate_points_with_degrees(points: List[Dict[str, int]]) -> List[Dict[str, int]]:
    out = []
    for p in points:
        try:
            vp = dict(p)
            v = int(vp.get("vertical", 0))
            h = int(vp.get("horizontal", 0))
            vp["vertical_degrees"] = _vertical_to_degrees(v)
            vp["horizontal_degrees"] = _horizontal_to_degrees(h)
            out.append(vp)
        except Exception:
            continue
    return out


def _dedupe_cruise_points(points: List[Dict[str, int]]) -> List[Dict[str, int]]:
    out = []
    seen = set()
    for p in points or []:
        try:
            v = int(p.get("vertical", 0))
            h = int(p.get("horizontal", 0))
        except Exception:
            continue
        key = (v, h)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def _resolve_ioctl_result(res):
    try:
        if isinstance(res, (list, dict)):
            return res
        fn = getattr(res, "result", None)
        if callable(fn):
            try:
                return fn()
            except TypeError:
                pass
        fn2 = getattr(res, "wait", None)
        if callable(fn2):
            try:
                return fn2()
            except Exception:
                pass
        if hasattr(res, "value"):
            return getattr(res, "value")
    except Exception:
        pass
    return res


async def to_thread(f):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(toThreadExecutor, f)


class CodecInfo:
    videoCodec: str
    videoCodecInfo: tuple[bytes, bytes]
    audioCodec: str
    audioSampleRate: int

    def __init__(
        self,
        videoCodec: str,
        videoCodecInfo: tuple[bytes, bytes],
        audioCodec: str,
        audioSampleRate: int,
    ) -> None:
        self.videoCodec = videoCodec
        self.videoCodecInfo = videoCodecInfo
        self.audioCodec = audioCodec
        self.audioSampleRate = audioSampleRate


class WyzeCamera(scrypted_sdk.ScryptedDeviceBase, VideoCamera, Settings, PanTiltZoom, HttpRequestHandler):
    def __init__(
        self, nativeId: str | None, plugin: WyzePlugin, camera: wyzecam.WyzeCamera
    ):
        super().__init__(nativeId=nativeId)
        self.plugin = plugin
        self.camera = camera
        self.streams = set()
        self.activeStream = None
        self.audioQueues = set()
        self.main: CodecInfo = None
        self.sub: CodecInfo = None
        self.mainFrameSize = FRAME_SIZE_2K if camera.is_2k else FRAME_SIZE_1080P
        self.subByteRate = 30
        self.ptzQueue = asyncio.Queue[scrypted_sdk.PanTiltZoomCommand]()
        self.ptzResponseQueue: asyncio.Queue[dict] = asyncio.Queue()
        self._control_lock = threading.Lock()
        self._ptz_pending: Dict[str, asyncio.Future] = {}
        self._ptz_pending_lock = threading.Lock()
        self._cruise_points_cache: List[Dict[str, int]] = []
        self._cruise_points_cache_ts: float = 0.0
        self._cruise_points_refresh_lock = asyncio.Lock()

        self.rfcServer = asyncio.ensure_future(
            self.ensureServer(self.handleMainRfcClient)
        )
        self.rfcSubServer = asyncio.ensure_future(
            self.ensureServer(self.handleSubRfcClient)
        )

        if camera.is_pan_cam:
            self.ptzCapabilities = {
                "pan": True,
                "tilt": True,
            }

        try:
            asyncio.ensure_future(self._bootstrap_cruise_points())
        except Exception:
            pass

        try:
            asyncio.ensure_future(self._ptz_response_consumer())
        except Exception:
            pass

    async def ptzCommand(self, command: scrypted_sdk.PanTiltZoomCommand = None, **kwargs) -> None:
        if command is None and kwargs:
            if "command" in kwargs and isinstance(kwargs.get("command"), str):
                try:
                    command = json.loads(kwargs.get("command"))
                except Exception:
                    command = {"raw": kwargs.get("command")}
            else:
                command = dict(kwargs)
        if isinstance(command, list) and len(command) == 1:
            command = command[0]

        if isinstance(command, dict):
            if "index" in command:
                try:
                    command["index"] = int(command["index"])
                except Exception:
                    pass
            if "speed" in command:
                try:
                    command["speed"] = float(command["speed"])
                except Exception:
                    pass
            if "pan" in command:
                try:
                    command["pan"] = float(command["pan"])
                except Exception:
                    pass
            if "tilt" in command:
                try:
                    command["tilt"] = float(command["tilt"])
                except Exception:
                    pass

        if command is None:
            raise TypeError("ptzCommand requires a command dict")

        try:
            if isinstance(command, dict) and "action" in command:
                action = command.get("action")
                if action in ("goto_cruise_point", "get_cruise_points") and not command.get("request_id"):
                    cmd = dict(command)
                    cmd["request_id"] = uuid.uuid4().hex
                    try:
                        self.print("ptz queued:", json.dumps(cmd, default=str))
                    except Exception:
                        try:
                            self.print("ptz queued:", str(cmd))
                        except Exception:
                            pass
                    try:
                        asyncio.ensure_future(self._ptz_action_with_retry(cmd))
                    except Exception:
                        await self.ptzQueue.put(cmd)
                    return
        except Exception:
            pass

        try:
            self.print("ptz queued:", json.dumps(command, default=str))
        except Exception:
            try:
                self.print("ptz queued:", str(command))
            except Exception:
                pass

        await self.ptzQueue.put(command)

        try:
            has_active = bool(self.streams) or (self.activeStream is not None)
            if not has_active and isinstance(command, dict) and "action" in command:
                msg = {
                    "type": "error",
                    "action": "queued",
                    "message": "no active stream; open a live view for the camera so PTZ commands can be processed",
                    "command": command,
                }
                try:
                    self.print("ptz response:", json.dumps(msg, default=str))
                except Exception:
                    pass
                try:
                    await scrypted_sdk.deviceManager.onDeviceEvent(
                        self.nativeId, "wyze.ptz_response", msg
                    )
                except Exception:
                    pass
                try:
                    asyncio.ensure_future(self._pending_ptz_control(command, delay=3.0))
                except Exception:
                    pass
        except Exception:
            pass

    async def _ptz_action_with_retry(self, command: dict, retries: int = 3, timeout: float = 2.0, retry_delay: float = 0.25):
        try:
            req_id = command.get("request_id") if isinstance(command, dict) else None
        except Exception:
            req_id = None

        if not req_id:
            req_id = uuid.uuid4().hex
            command = dict(command or {})
            command["request_id"] = req_id

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        with self._ptz_pending_lock:
            self._ptz_pending[req_id] = fut

        try:
            last_timeout = False
            for attempt in range(retries + 1):
                last_timeout = False
                try:
                    await self.ptzQueue.put(command)
                except Exception:
                    break

                try:
                    await asyncio.wait_for(asyncio.shield(fut), timeout=timeout)
                    return
                except asyncio.TimeoutError:
                    last_timeout = True
                    if attempt < retries:
                        try:
                            await asyncio.sleep(retry_delay)
                        except Exception:
                            pass
                    continue
                except Exception:
                    return

            if last_timeout and not fut.done():
                msg = {
                    "type": "error",
                    "action": command.get("action") or "ptz",
                    "message": f"no PTZ response after {retries + 1} attempt(s)",
                    "command": command,
                    "request_id": req_id,
                }
                try:
                    await self.ptzResponseQueue.put(msg)
                except Exception:
                    pass
                try:
                    fut.set_result(msg)
                except Exception:
                    pass
        finally:
            with self._ptz_pending_lock:
                self._ptz_pending.pop(req_id, None)

    async def _pending_ptz_control(self, command: dict, delay: float = 1.5):
        try:
            await asyncio.sleep(delay)
            has_active = bool(self.streams) or (self.activeStream is not None)
            if has_active:
                return
            try:
                if getattr(self, "ptzResponseQueue", None) and self.ptzResponseQueue.qsize() > 0:
                    return
            except Exception:
                pass
            try:
                await self._handle_ptz_control(command)
            except Exception as e:
                try:
                    await self.ptzResponseQueue.put({"type": "error", "action": "ptz_control", "message": str(e)})
                except Exception:
                    pass
        except Exception:
            pass

    async def ptzGoToPreset(self, index: int) -> None:
        try:
            await self.ptzCommand({"action": "goto_cruise_point", "index": int(index)})
        except Exception:
            pass

    async def webhookGotoPreset(self, index: int = 1):
        try:
            idx = int(index)
        except Exception:
            idx = 1
        await self.ptzCommand({"action": "goto_cruise_point", "index": idx})
        return {"ok": True, "queued": True, "action": "goto_cruise_point", "index": idx}

    async def webhookPtz(self, command: dict = None):
        if isinstance(command, list) and len(command) == 1:
            command = command[0]
        if not isinstance(command, dict):
            raise TypeError("webhookPtz requires a dict command")
        if "index" in command:
            try:
                command["index"] = int(command["index"])
            except Exception:
                pass
        await self.ptzCommand(command)
        return {"ok": True, "queued": True, "command": command}

    async def onRequest(self, request, response):
        try:
            url = getattr(request, "url", None)
            if not url and isinstance(request, dict):
                url = request.get("url")
            url = url or ""

            parsed = urllib.parse.urlparse(url)
            path = parsed.path or ""
            qs = urllib.parse.parse_qs(parsed.query or "")

            body = None
            raw_body = getattr(request, "body", None)
            if raw_body is None and isinstance(request, dict):
                raw_body = request.get("body")
            if isinstance(raw_body, (bytes, bytearray)):
                try:
                    body = raw_body.decode("utf-8", "ignore")
                except Exception:
                    body = None
            elif isinstance(raw_body, str):
                body = raw_body

            command = None
            if body:
                try:
                    command = json.loads(body)
                except Exception:
                    command = None

            if command is None and qs:
                flat = {k: (v[0] if isinstance(v, list) and v else v) for k, v in qs.items()}
                if "command" in flat:
                    try:
                        command = json.loads(flat["command"])
                    except Exception:
                        command = {"command": flat["command"]}
                elif "action" in flat:
                    command = flat

            if command is None:
                parts = [p for p in path.split("/") if p]
                if len(parts) >= 2 and parts[-2] == "preset":
                    try:
                        idx = int(parts[-1])
                        command = {"action": "goto_cruise_point", "index": idx}
                    except Exception:
                        command = None

            if isinstance(command, list) and len(command) == 1:
                command = command[0]

            if not isinstance(command, dict):
                response.send(
                    json.dumps({
                        "ok": False,
                        "error": "missing/invalid command",
                        "hint": "Send JSON body like {\"action\":\"goto_cruise_point\",\"index\":2} or query params action=...&index=...",
                        "url": url,
                        "path": path,
                    }),
                    {
                        "code": 400,
                        "headers": {"Content-Type": "application/json"},
                    },
                )
                return

            if "index" in command:
                try:
                    command["index"] = int(command["index"])
                except Exception:
                    pass

            try:
                await self.ptzCommand(command)
            except Exception as e:
                response.send(
                    json.dumps({"ok": False, "error": str(e), "command": command}),
                    {"code": 500, "headers": {"Content-Type": "application/json"}},
                )
                return

            response.send(
                json.dumps({"ok": True, "queued": True, "command": command}),
                {"code": 200, "headers": {"Content-Type": "application/json"}},
            )
        except Exception as e:
            try:
                response.send(
                    json.dumps({"ok": False, "error": str(e)}),
                    {"code": 500, "headers": {"Content-Type": "application/json"}},
                )
            except Exception:
                pass

    async def _handle_ptz_control(self, command: dict):
        loop = asyncio.get_running_loop()
        try:
            res = await loop.run_in_executor(None, self._run_ptz_control_sync, command)
            try:
                await self.ptzResponseQueue.put(res)
            except Exception:
                pass
        except Exception as e:
            try:
                await self.ptzResponseQueue.put({"type": "error", "action": "ptz_control", "message": str(e)})
            except Exception:
                pass

    async def _bootstrap_cruise_points(self):
        try:
            await asyncio.sleep(2.0)
        except Exception:
            return
        try:
            await self.refreshCruisePoints(force=False)
        except Exception:
            pass

    async def _publish_ptz_presets(self, points: List[Dict[str, int]]):
        if not self.camera.is_pan_cam:
            return
        try:
            display_points = _dedupe_cruise_points(points)
            presets = {}
            for i, p in enumerate(display_points):
                vd = p.get("vertical_degrees")
                hd = p.get("horizontal_degrees")
                if vd is None:
                    vd = _vertical_to_degrees(p.get("vertical", 0))
                if hd is None:
                    hd = _horizontal_to_degrees(p.get("horizontal", 0))
                label = f"Preset {i + 1}"
                if vd is not None and hd is not None:
                    label = f"Preset {i + 1} (tilt {vd}, pan {hd})"
                presets[str(i + 1)] = label
            caps = getattr(self, "ptzCapabilities", {"pan": True, "tilt": True})
            caps = {**caps, "presets": presets}
            self.ptzCapabilities = caps
        except Exception:
            pass

    async def refreshCruisePoints(self, force: bool = False) -> List[Dict[str, int]]:
        async with self._cruise_points_refresh_lock:
            now_ts = time.time()
            if not force and self._cruise_points_cache and (now_ts - self._cruise_points_cache_ts) < 60:
                return self._cruise_points_cache

            points = await self.getCruisePoints()
            points = _annotate_points_with_degrees(_normalize_cruise_points(points))
            self._cruise_points_cache = points
            self._cruise_points_cache_ts = now_ts
            await self._publish_ptz_presets(points)
            return points

    async def getCruisePoints(self) -> List[Dict[str, int]]:
        has_active = bool(self.streams) or (self.activeStream is not None)
        if has_active:
            request_id = uuid.uuid4().hex
            loop = asyncio.get_running_loop()
            fut: asyncio.Future = loop.create_future()
            with self._ptz_pending_lock:
                self._ptz_pending[request_id] = fut
            try:
                await self.ptzQueue.put({"action": "get_cruise_points", "request_id": request_id})
                res = await asyncio.wait_for(fut, timeout=6.0)
            finally:
                with self._ptz_pending_lock:
                    self._ptz_pending.pop(request_id, None)

            if isinstance(res, dict) and res.get("type") == "cruise_points":
                return res.get("points", [])
            if isinstance(res, dict) and res.get("type") == "error":
                raise RuntimeError(f"get_cruise_points error: {res.get('message')}")
            return _normalize_cruise_points(res if isinstance(res, list) else [])

        loop = asyncio.get_running_loop()
        try:
            res = await loop.run_in_executor(None, self._run_ptz_control_sync, {"action": "get_cruise_points"})
        except Exception as e:
            raise RuntimeError(f"ptz control failed: {e}")

        if not isinstance(res, dict):
            return _normalize_cruise_points(res if isinstance(res, list) else [])
        if res.get("type") == "cruise_points":
            return res.get("points", [])
        if res.get("type") == "error":
            raise RuntimeError(f"get_cruise_points error: {res.get('message')}")
        return _normalize_cruise_points(res.get("points") or [])

    async def _ptz_response_consumer(self):
        while True:
            try:
                msg = await self.ptzResponseQueue.get()
                if not isinstance(msg, dict):
                    continue
                req_id = msg.get("request_id")
                if req_id:
                    with self._ptz_pending_lock:
                        fut = self._ptz_pending.get(req_id)
                    if fut and not fut.done():
                        try:
                            fut.set_result(msg)
                        except Exception:
                            pass
                if msg.get("type") == "cruise_points":
                    points = msg.get("points") or []
                    try:
                        points = _annotate_points_with_degrees(_normalize_cruise_points(points))
                        self._cruise_points_cache = points
                        self._cruise_points_cache_ts = time.time()
                        await self._publish_ptz_presets(points)
                    except Exception:
                        pass
            except Exception:
                pass

    def _run_ptz_control_sync(self, cmd):
        request_id = None
        try:
            if isinstance(cmd, dict):
                request_id = cmd.get("request_id")
        except Exception:
            request_id = None
        try:
            wyze_iotc = getattr(self.plugin, "wyze_iotc", None)
            if not wyze_iotc:
                with self._control_lock:
                    wyze_iotc = getattr(self.plugin, "wyze_iotc", None)
                    if not wyze_iotc:
                        wyze_iotc = wyzecam.WyzeIOTC(
                            tutk_platform_lib=self.plugin.tutk_platform_lib,
                            sdk_key=sdkKey,
                            max_num_av_channels=1,
                        )
                        try:
                            wyze_iotc.initialize()
                        except Exception:
                            pass

            account = self.plugin.account
            camera = self.camera
            with wyzecam.WyzeIOTCSession(
                wyze_iotc.tutk_platform_lib,
                account,
                camera,
                frame_size=FRAME_SIZE_360P,
                bitrate=0,
                enable_audio=False,
                stream_state=c_int(2),
            ) as sess:

                def do_ioctl(msg, retries=3, backoff=0.5):
                    last = None
                    for i in range(retries):
                        try:
                            with sess.iotctrl_mux() as mux:
                                res = mux.send_ioctl(msg)
                                return _resolve_ioctl_result(res)
                        except Exception as e:
                            last = e
                            time.sleep(backoff * (i + 1))
                    raise last

                if isinstance(cmd, dict) and "action" in cmd:
                    action = cmd.get("action")
                    if action == "get_cruise_points":
                        try:
                            res = do_ioctl(tutk_protocol.K11010GetCruisePoints(), retries=4)
                            points = res if isinstance(res, list) else []
                            points = _normalize_cruise_points(points)
                            points = _annotate_points_with_degrees(points)
                            return {"type": "cruise_points", "points": points, "request_id": request_id}
                        except Exception as e:
                            return {"type": "error", "action": "get_cruise_points", "message": str(e), "request_id": request_id}
                    elif action == "goto_cruise_point":
                        idx = int(cmd.get("index", 1))
                        try:
                            res = do_ioctl(tutk_protocol.K11010GetCruisePoints(), retries=4)
                            points = res if isinstance(res, list) else []
                            points = _normalize_cruise_points(points)
                            points = _annotate_points_with_degrees(points)
                            if not points or idx < 1 or idx > len(points):
                                return {"type": "error", "action": "goto_cruise_point", "message": "invalid index", "points": points, "request_id": request_id}
                            p = points[idx - 1]
                            v = int(p.get("vertical", 0))
                            h = int(p.get("horizontal", 0))
                            vd = _vertical_to_degrees(v)
                            hd = _horizontal_to_degrees(h)
                            do_ioctl(tutk_protocol.K11018SetPTZPosition(vd, hd), retries=4)
                            return {"type": "goto_cruise_point", "index": idx, "point": p, "status": "ok", "request_id": request_id}
                        except Exception as e:
                            return {"type": "error", "action": "goto_cruise_point", "message": str(e), "request_id": request_id}
                return {"type": "error", "action": "ptz_control", "message": "unsupported action", "request_id": request_id}
        except Exception as e:
            return {"type": "error", "action": "ptz_control", "message": str(e), "request_id": request_id}

    def safeParseJsonStorage(self, key: str):
        try:
            return json.loads(self.storage.getItem(key))
        except:
            return None

    def getMuted(self):
        return False

    def getMainByteRate(self, default=False):
        try:
            bit = int(self.safeParseJsonStorage("bitrate"))
            bit = round(bit / 8)
            bit = bit if 1 <= bit <= 255 else 0
            if not bit:
                raise
            if default:
                return bit * 8
            return bit
        except:
            if default:
                return "Default"
            return 240 if self.camera.is_2k else 160

    async def getSettings(self):
        ret: List[Setting] = []
        ret.append(
            {
                "key": "bitrate",
                "title": "Main Stream Bitrate",
                "description": "The bitrate used by the main stream.",
                "value": self.safeParseJsonStorage("bitrate"),
                "combobox": True,
                "value": str(self.getMainByteRate(True)),
                "choices": [
                    "Default",
                    "500",
                    "750",
                    "1000",
                    "1400",
                    "1800",
                    "2000",
                ],
            }
        )
        return ret

    async def putSetting(self, key, value):
        self.storage.setItem(key, json.dumps(value))

        await scrypted_sdk.deviceManager.onDeviceEvent(
            self.nativeId, ScryptedInterface.Settings.value, None
        )

        await scrypted_sdk.deviceManager.onDeviceEvent(
            self.nativeId, ScryptedInterface.VideoCamera.value, None
        )

    async def handleMainRfcClient(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ):
        return await self.handleRfcClient(False, reader, writer)

    async def handleSubRfcClient(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ):
        return await self.handleRfcClient(True, reader, writer)

    async def handleRfcClient(
        self,
        substream: bool,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ):
        info = self.sub if substream else self.main
        ffmpeg = await scrypted_sdk.mediaManager.getFFmpegPath()
        loop = asyncio.get_event_loop()

        stream_token = object()
        self.streams.add(stream_token)
        self.activeStream = stream_token

        class RFC4571Writer(asyncio.DatagramProtocol):
            def connection_made(self, transport):
                sock = transport.get_extra_info('socket')
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)

            def datagram_received(self, data, addr):
                l = len(data)
                len_data = struct.pack(">H", l)
                writer.write(len_data)
                writer.write(data)

        vt, vp = await loop.create_datagram_endpoint(
            lambda: RFC4571Writer(), local_addr=("127.0.0.1", 0)
        )
        vhost, vport = vt._sock.getsockname()

        vprocess = await asyncio.create_subprocess_exec(
            ffmpeg,
            "-analyzeduration",
            "0",
            "-probesize",
            "100k",
            "-f",
            "h264",
            "-i",
            "pipe:0",
            "-vcodec",
            "copy",
            "-an",
            "-f",
            "rtp",
            "-payload_type",
            "96",
            f"rtp://127.0.0.1:{vport}?pkt_size=64000",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        vprocess.stdin.write(b"\x00\x00\x00\x01")
        vprocess.stdin.write(info.videoCodecInfo[0])
        vprocess.stdin.write(b"\x00\x00\x00\x01")
        vprocess.stdin.write(info.videoCodecInfo[1])

        aprocess: asyncio.subprocess.Process = None
        if not self.getMuted():
            at, ap = await loop.create_datagram_endpoint(
                lambda: RFC4571Writer(), local_addr=("127.0.0.1", 0)
            )

            ahost, aport = at._sock.getsockname()

            aprocess = await asyncio.create_subprocess_exec(
                ffmpeg,
                "-analyzeduration",
                "0",
                "-probesize",
                "1024",
                "-f",
                info.audioCodec,
                "-ar",
                f"{info.audioSampleRate}",
                "-i",
                "pipe:0",
                "-acodec",
                "copy",
                "-vn",
                "-f",
                "rtp",
                "-payload_type",
                "97",
                f"rtp://127.0.0.1:{aport}?pkt_size=64000",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )

        def pkill(p: asyncio.subprocess.Process):
            try:
                p.stdin.write_eof()
            except:
                pass
            def terminate():
                try:
                    p.terminate()
                except:
                    pass
            def kill():
                try:
                    p.kill()
                except:
                    pass
            loop.call_later(5, terminate)
            loop.call_later(10, kill)

        try:
            forked, gen = self.forkAndStream(substream)
            async for audio, data, codec, sampleRate in gen:
                if writer.is_closing():
                    return

                p = aprocess if audio else vprocess
                if p:
                    p.stdin.write(data)
                    await p.stdin.drain()
        except Exception as e:
            print_exception(self.print, e)
        finally:
            try:
                self.streams.discard(stream_token)
                if self.activeStream is stream_token:
                    self.activeStream = None
            except Exception:
                pass
            forked.worker.terminate()
            writer.close()
            self.print("rfc reader closed")
            pkill(vprocess)
            if aprocess:
                pkill(aprocess)

    async def ensureServer(self, cb) -> int:
        host = os.environ.get("SCRYPTED_CLUSTER_ADDRESS", None) or "127.0.0.1"
        server = await asyncio.start_server(cb, host, 0)
        sock = server.sockets[0]
        host, port = sock.getsockname()
        asyncio.ensure_future(server.serve_forever())
        return host, port

    async def probeCodec(self, substream: bool):
        sps: bytes = None
        pps: bytes = None
        audioCodec: str = None
        audioSampleRate: int = None
        forked, gen = self.forkAndStream(substream)
        try:
            async for audio, data, codec, sampleRate in gen:
                if not audio and (not sps or not pps) and len(data):
                    nalus = data.split(b"\x00\x00\x00\x01")[1:]
                    for nalu in nalus:
                        naluType = nalu[0] & 0x1f
                        if naluType == 7:
                            sps = nalu
                        elif naluType == 8:
                            pps = nalu

                if audio and not self.getMuted():
                    audioCodec = codec
                    audioSampleRate = sampleRate

                if sps and pps and (audioCodec or self.getMuted()):
                    return (audioCodec, audioSampleRate, sps, pps)
        finally:
            forked.worker.terminate()

    def forkAndStream(self, substream: bool):
        frameSize = FRAME_SIZE_360P if substream else self.mainFrameSize
        bitrate = self.subByteRate if substream else self.getMainByteRate()
        account = self.plugin.account.model_copy()
        if substream:
            account.phone_id = account.phone_id[2:]

        forked = scrypted_sdk.fork()

        activity = time.time()
        done = False
        loop = asyncio.get_event_loop()

        def reset_timer():
            if done:
                return
            nonlocal activity
            if time.time() - activity > 15:
                forked.worker.terminate()
            else:
                loop.call_later(1, reset_timer)

        loop.call_later(30, reset_timer)

        async def gen():
            nonlocal activity
            try:
                wyzeFork: WyzeFork = await forked.result
                async for payload in await wyzeFork.open_stream(
                    self.plugin.tutk_platform_lib,
                    account.model_dump(),
                    self.camera.model_dump(),
                    frameSize,
                    bitrate,
                    self.getMuted(),
                    self.ptzQueue,
                    self.ptzResponseQueue,
                ):
                    audio: bool = payload["audio"]
                    data: bytes = payload["data"]
                    codec: bytes = payload["codec"]
                    sampleRate: bytes = payload["sampleRate"]
                    if not audio and len(data):
                        activity = time.time()
                    yield audio, data, codec, sampleRate
            finally:
                nonlocal done
                done = True
                forked.worker.terminate()

        return forked, gen()

    async def getVideoStream(
        self, options: RequestMediaStreamOptions = None
    ) -> Coroutine[Any, Any, MediaObject]:
        substream = options and options.get("id") == "substream"

        try:
            if substream:
                if not self.sub:
                    self.print("fetching sub codec info")
                    codec, sampleRate, sps, pps = await self.probeCodec(True)
                    self.sub = CodecInfo("h264", (sps, pps), codec, sampleRate)
                    self.print("sub codec info", len(sps), len(pps))
                info = self.sub

            else:
                if not self.main:
                    self.print("fetching main codec info")
                    codec, sampleRate, sps, pps = await self.probeCodec(False)
                    self.main = CodecInfo("h264", (sps, pps), codec, sampleRate)
                    self.print("main codec info", len(sps), len(pps))
                info = self.main
        except Exception as e:
            self.print("Error retrieving codec info")
            print_exception(self.print, e)
            raise

        rfcHost, rfcPort = await self.rfcSubServer if substream else await self.rfcServer

        msos = self.getVideoStreamOptionsInternal()
        mso = msos[1] if substream else msos[0]
        if not self.getMuted():
            mso["audio"]["sampleRate"] = info.audioSampleRate

        sps = base64.b64encode(info.videoCodecInfo[0]).decode()
        pps = base64.b64encode(info.videoCodecInfo[1]).decode()
        audioCodecName = codecMap.get(info.audioCodec)
        sdp = f"""v=0
o=- 0 0 IN IP4 0.0.0.0
s=No Name
t=0 0
m=video 0 RTP/AVP 96
c=IN IP4 0.0.0.0
a=rtpmap:96 H264/90000
a=fmtp:96 packetization-mode=1; sprop-parameter-sets={sps},{pps}; profile-level-id=4D0029
"""
        if not self.getMuted():
            sdp += f"""
m=audio 0 RTP/AVP 97
c=IN IP4 0.0.0.0
b=AS:128
a=rtpmap:97 {audioCodecName}/{info.audioSampleRate}/1
"""
        rfc = {
            "url": f"tcp://{rfcHost}:{rfcPort}",
            "sdp": sdp,
            "mediaStreamOptions": mso,
        }
        jsonString = json.dumps(rfc)
        mo = await scrypted_sdk.mediaManager.createMediaObject(
            jsonString.encode(),
            "x-scrypted/x-rfc4571",
            {
                "sourceId": self.id,
            },
        )
        return mo

    def getVideoStreamOptionsInternal(self) -> list[ResponseMediaStreamOptions]:
        ret: List[ResponseMediaStreamOptions] = []
        ret.append(
            {
                "id": "mainstream",
                "name": "Main Stream",
                "video": {
                    "codec": "h264",
                    "width": 2560 if self.camera.is_2k else 1920,
                    "height": 1440 if self.camera.is_2k else 1080,
                },
                "audio": None if self.getMuted() else {},
            }
        )
        # not all wyze can substream, need to create an exhaustive list?
        # wyze pan v2 does not, for example. others seem to set can_substream to False,
        # but DO actually support it
        ret.append(
            {
                "id": "substream",
                "name": "Substream",
                "video": {
                    "codec": "h264",
                    "width": 640,
                    "height": 360,
                },
                "audio": None if self.getMuted() else {},
            }
        )
        return ret

    async def getVideoStreamOptions(self) -> list[ResponseMediaStreamOptions]:
        return self.getVideoStreamOptionsInternal()


class WyzePlugin(scrypted_sdk.ScryptedDeviceBase, DeviceProvider):
    def __init__(self):
        super().__init__()
        self.authInfo: wyzecam.WyzeCredential = None
        self.cameras: Dict[str, wyzecam.WyzeCamera] = {}
        self.account: wyzecam.WyzeAccount = None
        self.tutk_platform_lib: str = None
        self.wyze_iotc: wyzecam.WyzeIOTC = None
        self.last_ts = 0
        self.deviceInstances: Dict[str, WyzeCamera] = {}

        if sys.platform.find("linux"):
            self.print("Wyze plugin must be installed under Scrypted for Linux. Found: " + sys.platform)
            return

        if platform.machine() == "x86_64":
            suffix = "amd64"
        elif platform.machine() == "aarch64":
            suffix = "arm64"
        else:
            self.print("Architecture not supported.")
            return

        libVersion = "v1"
        self.tutk_platform_lib = self.downloadFile(
            f"https://github.com/koush/docker-wyze-bridge/raw/main/app/lib.{suffix}",
            f"{libVersion}/lib.{suffix}",
        )

        self.wyze_iotc = wyzecam.WyzeIOTC(
            tutk_platform_lib=self.tutk_platform_lib,
            sdk_key=sdkKey,
            max_num_av_channels=32,
        )
        self.wyze_iotc.initialize()

        self.print(self.tutk_platform_lib)
        asyncio.ensure_future(self.refreshDevices())

    def downloadFile(self, url: str, filename: str):
        filesPath = os.path.join(os.environ["SCRYPTED_PLUGIN_VOLUME"], "files")
        fullpath = os.path.join(filesPath, filename)
        if os.path.isfile(fullpath):
            return fullpath
        os.makedirs(os.path.dirname(fullpath), exist_ok=True)
        tmp = fullpath + ".tmp"
        urllib.request.urlretrieve(url, tmp)
        os.rename(tmp, fullpath)
        return fullpath

    async def getDevice(self, nativeId: str) -> Any:
        camera = self.cameras.get(nativeId)
        if not camera:
            return
        existing = self.deviceInstances.get(nativeId)
        if existing:
            existing.camera = camera
            return existing
        device = WyzeCamera(nativeId, self, camera)
        self.deviceInstances[nativeId] = device
        return device

    def safeParseJsonStorage(self, key: str):
        try:
            return json.loads(self.storage.getItem(key))
        except:
            return None

    async def pollEvents(self):
        current_ms = int(time.time() + 60) * 1000
        params = {
            "count": 20,
            "order_by": 1,
            "begin_time": max((self.last_ts + 1) * 1_000, (current_ms - 1_000_000)),
            "end_time": current_ms,
            "device_mac_list": [],
        }

        try:
            resp = post_device(self.authInfo, "get_event_list", params)
            return time.time(), resp["event_list"]
        except RateLimitError as ex:
            self.print(f"[EVENTS] RateLimitError: {ex}, cooling down.")
            return ex.reset_by, []
        except (HTTPError, RequestException) as ex:
            self.print(f"[EVENTS] HTTPError: {ex}, cooling down.")
            return time.time() + 60, []

    async def refreshDevices(self):
        print("refreshing")

        email = self.safeParseJsonStorage("email")
        password = self.safeParseJsonStorage("password")
        keyId = self.safeParseJsonStorage("keyId")
        apiKey = self.safeParseJsonStorage("apiKey")

        if not email or not password or not keyId or not apiKey:
            self.print("Wyze Plugin Settings not configured.")
            return

        auth_info = wyzecam.login(email, password, api_key=apiKey, key_id=keyId)
        self.authInfo = auth_info
        self.account = wyzecam.get_user_info(auth_info)
        cameras = wyzecam.get_camera_list(auth_info)
        # await self.pollEvents()
        manifest: scrypted_sdk.DeviceManifest = {"devices": []}
        for camera in cameras:
            self.cameras[camera.p2p_id] = camera

            interfaces: List[ScryptedInterface] = [
                ScryptedInterface.Settings.value,
                ScryptedInterface.VideoCamera.value,
                ScryptedInterface.HttpRequestHandler.value,
            ]

            if camera.is_pan_cam:
                interfaces.append(ScryptedInterface.PanTiltZoom.value)

            if camera.is_battery:
                interfaces.append(ScryptedInterface.Battery.value)

            if camera.is_vertical:
                deviceType = ScryptedDeviceType.Doorbell.value
                interfaces.append(ScryptedInterface.BinarySensor.value)
            else:
                deviceType = ScryptedDeviceType.Camera.value

            device: scrypted_sdk.Device = {
                "nativeId": camera.p2p_id,
                "type": deviceType,
                "name": camera.nickname,
                "interfaces": interfaces,
                "info": {
                    "firmware": camera.firmware_ver,
                    "ip": camera.ip,
                    "mac": camera.mac,
                    "model": camera.model_name,
                },
            }

            manifest["devices"].append(device)

        await scrypted_sdk.deviceManager.onDevicesChanged(manifest)

    async def getSettings(self):
        ret: List[Setting] = []
        ret.append(
            {
                "key": "email",
                "title": "Email",
                "description": "The email used to log into the Wyze account. This can not be a Google or Apple Sign in via OAuth.",
                "value": self.safeParseJsonStorage("email"),
            }
        )
        ret.append(
            {
                "key": "password",
                "title": "Password",
                "type": "password",
                "value": self.safeParseJsonStorage("password"),
            }
        )
        ret.append(
            {
                "key": "keyId",
                "title": "Key Id",
                "description": "The Key Id retrieved from the Wyze portal.",
                "value": self.safeParseJsonStorage("keyId"),
            }
        )
        ret.append(
            {
                "key": "apiKey",
                "title": "API Key",
                "type": "password",
                "description": "The API Key retrieved from the Wyze portal.",
                "value": self.safeParseJsonStorage("apiKey"),
            }
        )
        return ret

    async def putSetting(self, key, value):
        self.storage.setItem(key, json.dumps(value))

        asyncio.ensure_future(self.refreshDevices())

        await scrypted_sdk.deviceManager.onDeviceEvent(
            None, ScryptedInterface.Settings.value, None
        )


def create_scrypted_plugin():
    return WyzePlugin()


class WyzeFork:
    async def open_stream(
        self,
        tutk_platform_lib: str,
        account_json,
        camera_json,
        frameSize: int,
        bitrate: int,
        muted: bool,
        ptzQueue: asyncio.Queue[scrypted_sdk.PanTiltZoomCommand],
        ptzResponseQueue: asyncio.Queue[dict],
    ):
        account = wyzecam.WyzeAccount(**account_json)
        camera = wyzecam.WyzeCamera(**camera_json)

        wyze_iotc = wyzecam.WyzeIOTC(
            tutk_platform_lib=tutk_platform_lib,
            sdk_key=sdkKey,
            max_num_av_channels=32,
        )
        wyze_iotc.initialize()

        loop = asyncio.get_event_loop()
        aq: asyncio.Queue[tuple[bool, bytes, Any]] = asyncio.Queue()

        closed = False

        def run():
            with wyzecam.WyzeIOTCSession(
                wyze_iotc.tutk_platform_lib,
                account,
                camera,
                frame_size=frameSize,
                bitrate=bitrate,
                enable_audio=not muted,
                # CONNECTING?
                stream_state=c_int(2),
            ) as sess:
                nonlocal closed

                async def ptzRunner():
                    while not closed:
                        command = await ptzQueue.get()
                        try:
                            if isinstance(command, dict) and "action" in command:
                                action = command.get("action")
                                request_id = None
                                try:
                                    request_id = command.get("request_id")
                                except Exception:
                                    request_id = None

                                def do_ioctl_sync(msg, retries=3, backoff=0.5):
                                    last_exc = None
                                    for i in range(retries):
                                        try:
                                            with sess.iotctrl_mux() as mux:
                                                res = mux.send_ioctl(msg)
                                                res = _resolve_ioctl_result(res)
                                                return res
                                        except Exception as e:
                                            last_exc = e
                                            time.sleep(backoff * (i + 1))
                                    raise last_exc

                                if action == "get_cruise_points":
                                    try:
                                        res = do_ioctl_sync(tutk_protocol.K11010GetCruisePoints(), retries=4)
                                        points = res if isinstance(res, list) else []
                                        points = _normalize_cruise_points(points)
                                        points = _annotate_points_with_degrees(points)
                                        await ptzResponseQueue.put({"type": "cruise_points", "points": points, "request_id": request_id})
                                    except Exception as e:
                                        await ptzResponseQueue.put({"type": "error", "action": "get_cruise_points", "message": str(e), "request_id": request_id})
                                elif action == "goto_cruise_point":
                                    idx = int(command.get("index", 1))
                                    try:
                                        res = do_ioctl_sync(tutk_protocol.K11010GetCruisePoints(), retries=4)
                                        points = res if isinstance(res, list) else []
                                        points = _normalize_cruise_points(points)
                                        points = _annotate_points_with_degrees(points)
                                        if not points or idx < 1 or idx > len(points):
                                            await ptzResponseQueue.put({"type": "error", "action": "goto_cruise_point", "message": "invalid index", "points": points, "request_id": request_id})
                                        else:
                                            p = points[idx - 1]
                                            v = int(p.get("vertical", 0))
                                            h = int(p.get("horizontal", 0))
                                            vd = _vertical_to_degrees(v)
                                            hd = _horizontal_to_degrees(h)
                                            do_ioctl_sync(tutk_protocol.K11018SetPTZPosition(vd, hd), retries=4)
                                            await ptzResponseQueue.put({"type": "goto_cruise_point", "index": idx, "point": p, "status": "ok", "request_id": request_id})
                                    except Exception as e:
                                        await ptzResponseQueue.put({"type": "error", "action": "goto_cruise_point", "message": str(e), "request_id": request_id})
                                else:
                                    await ptzResponseQueue.put({"type": "error", "action": action, "message": "unsupported action", "request_id": request_id})
                            else:
                                movement = command.get(
                                    "movement",
                                    scrypted_sdk.PanTiltZoomMovement.Relative.value,
                                )
                                pan = command.get("pan", 0)
                                tilt = command.get("tilt", 0)
                                speed = command.get("speed", 1)
                                if (
                                    movement
                                    == scrypted_sdk.PanTiltZoomMovement.Absolute.value
                                ):
                                    pan = round(max(0, min(350, pan * 350)))
                                    tilt = round(max(0, min(40, tilt * 40)))
                                    message = tutk_protocol.K11018SetPTZPosition(tilt, pan)
                                    with sess.iotctrl_mux() as mux:
                                        mux.send_ioctl(message)
                                elif (
                                    movement
                                    == scrypted_sdk.PanTiltZoomMovement.Relative.value
                                ):
                                    # this is range which turns in a full rotation.
                                    scalar = 3072
                                    # speed is 1-9 inclusive
                                    speed = round(max(0, min(8, speed * 8)))
                                    speed += 1
                                    pan = round(max(-scalar, min(scalar, pan * scalar)))
                                    tilt = round(max(-scalar, min(scalar, tilt * scalar)))
                                    message = tutk_protocol.K11000SetRotaryByDegree(
                                        pan, tilt, speed
                                    )
                                    with sess.iotctrl_mux() as mux:
                                        mux.send_ioctl(message)
                                else:
                                    raise Exception(
                                        "Unknown PTZ cmmand: " + command["movement"]
                                    )
                        except Exception as e:
                            print_exception(print, e)

                asyncio.run_coroutine_threadsafe(ptzRunner(), loop)

                def ignore(self, *args, **kwargs):
                    pass
                def ignoreTrue(self, *args, **kwargs):
                    return True
                sess._audio_frame_slow = ignore
                sess._video_frame_slow = ignore
                sess._received_first_frame = ignoreTrue

                if not muted:

                    def runAudio():
                        nonlocal closed
                        try:
                            rate = sess.get_audio_sample_rate()
                            codec: str = None

                            for frame, frame_info in sess.recv_audio_data():
                                if closed:
                                    return
                                if not codec:
                                    codec, rate = sess.get_audio_codec_from_codec_id(
                                        frame_info.codec_id
                                    )
                                asyncio.run_coroutine_threadsafe(
                                    aq.put((True, frame, codec, rate, frame_info)),
                                    loop=loop,
                                )
                        except Exception as e:
                            # print_exception(print, e)
                            asyncio.run_coroutine_threadsafe(
                                aq.put((True, None, None, None, format_exception(e))),
                                loop=loop,
                            )
                        finally:
                            # print('done audio')
                            asyncio.run_coroutine_threadsafe(
                                aq.put((True, None, None, None, None)), loop=loop
                            )
                            closed = True

                    athread = threading.Thread(
                        target=runAudio, name="audio-" + camera.p2p_id
                    )
                    athread.start()
                else:
                    athread = None

                try:
                    videoParm = sess.camera.camera_info.get("videoParm")
                    fps = int((videoParm and videoParm.get("fps", 20)) or 20)

                    for frame in sess.recv_bridge_data():
                        if closed:
                            return
                        asyncio.run_coroutine_threadsafe(
                            aq.put((False, frame, None, None, None)), loop=loop
                        )
                except Exception as e:
                    # print_exception(print, e)
                    asyncio.run_coroutine_threadsafe(
                        aq.put((False, None, None, None, format_exception(e))),
                        loop=loop,
                    )
                finally:
                    # print('done video')
                    asyncio.run_coroutine_threadsafe(
                        aq.put((False, None, None, None, None)), loop=loop
                    )
                    closed = True

                if athread:
                    athread.join()

        vthread = threading.Thread(target=run, name="video-" + camera.p2p_id)
        vthread.start()

        try:
            while not closed:
                payload = await aq.get()
                audio, data, codec, sampleRate, info = payload
                if data == None:
                    return

                yield {
                    "__json_copy_serialize_children": True,
                    "data": data,
                    "audio": audio,
                    "codec": codec,
                    "sampleRate": sampleRate,
                }
        finally:
            closed = True


async def fork():
    return WyzeFork()
