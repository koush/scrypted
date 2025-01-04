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
import urllib.request
from ctypes import c_int
from typing import Any, Coroutine, Dict, List

import scrypted_sdk
from requests import HTTPError, RequestException
from scrypted_sdk.other import MediaObject
from scrypted_sdk.types import (DeviceProvider, PanTiltZoom,
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


class WyzeCamera(scrypted_sdk.ScryptedDeviceBase, VideoCamera, Settings, PanTiltZoom):
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

    async def ptzCommand(self, command: scrypted_sdk.PanTiltZoomCommand) -> None:
        await self.ptzQueue.put(command)

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
        return WyzeCamera(nativeId, self, camera)

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

                asyncio.ensure_future(ptzRunner(), loop=loop)

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
