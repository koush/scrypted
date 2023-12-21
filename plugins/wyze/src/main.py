from __future__ import annotations
from typing import Any, Coroutine, List, Dict, Callable, Iterator, MutableSet
import scrypted_sdk
import asyncio
import urllib.request
import os
import urllib
import sys
import platform
from scrypted_sdk.other import MediaObject
import wyzecam
import json
import threading
import queue
import traceback
from ctypes import c_int
import concurrent.futures
import subprocess
import base64
import struct

from wyzecam.tutk.tutk import (
    FRAME_SIZE_1080P,
    FRAME_SIZE_360P,
    BITRATE_360P,
    BITRATE_HD,
)

from scrypted_sdk.types import (
    DeviceProvider,
    RequestMediaStreamOptions,
    ResponseMediaStreamOptions,
    VideoCamera,
    ScryptedDeviceType,
    ScryptedInterface,
    Settings,
    Setting,
)

os.environ["TUTK_PROJECT_ROOT"] = os.path.join(
    os.environ["SCRYPTED_PLUGIN_VOLUME"], "zip/unzipped/fs"
)
sdkKey = "AQAAAIZ44fijz5pURQiNw4xpEfV9ZysFH8LYBPDxiONQlbLKaDeb7n26TSOPSGHftbRVo25k3uz5of06iGNB4pSfmvsCvm/tTlmML6HKS0vVxZnzEuK95TPGEGt+aE15m6fjtRXQKnUav59VSRHwRj9Z1Kjm1ClfkSPUF5NfUvsb3IAbai0WlzZE1yYCtks7NFRMbTXUMq3bFtNhEERD/7oc504b"

toThreadExecutor = concurrent.futures.ThreadPoolExecutor(
    max_workers=2, thread_name_prefix="image"
)

codecMap = {
    "mulaw": "PCMU",
    "alaw": "PCMA",
    "s16be": "L16",
    "opus": "OPUS",
    "aac": "MP4A-LATM",
}


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


class WyzeCamera(scrypted_sdk.ScryptedDeviceBase, VideoCamera):
    camera: wyzecam.WyzeCamera
    plugin: WyzePlugin
    streams: MutableSet[wyzecam.WyzeIOTCSession]
    activeStream: wyzecam.WyzeIOTCSession
    audioQueues: MutableSet[queue.Queue[tuple[bytes, Any]]]

    main: CodecInfo
    sub: CodecInfo

    def __init__(
        self, nativeId: str | None, plugin: WyzePlugin, camera: wyzecam.WyzeCamera
    ):
        super().__init__(nativeId=nativeId)
        self.plugin = plugin
        self.camera = camera
        self.streams = set()
        self.activeStream = None
        self.audioQueues = set()
        self.main = None
        self.sub = None

        self.mainServer = asyncio.ensure_future(self.ensureServer(self.handleClientHD))
        self.subServer = asyncio.ensure_future(self.ensureServer(self.handleClientSD))
        self.audioServer = asyncio.ensure_future(
            self.ensureServer(self.handleAudioClient)
        )
        self.rfcServer = asyncio.ensure_future(
            self.ensureServer(self.handleMainRfcClient)
        )
        self.rfcSubServer = asyncio.ensure_future(
            self.ensureServer(self.handleSubRfcClient)
        )

    async def handleClientHD(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ):
        return await self.handleClient(
            self.plugin.account.model_copy(),
            FRAME_SIZE_1080P,
            BITRATE_HD,
            reader,
            writer,
        )

    async def handleClientSD(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ):
        account = self.plugin.account.model_copy()
        # wyze cams will disconnect first stream if the phone id requests a second stream.
        # use a different substream phone id, similar to how docker wyze bridge does it.
        account.phone_id = account.phone_id[2:]
        return await self.handleClient(
            account,
            FRAME_SIZE_360P,
            BITRATE_360P,
            reader,
            writer,
        )

    def receiveAudioData(self):
        q: queue.Queue[tuple[bytes, Any]] = queue.Queue()
        self.audioQueues.add(q)
        try:
            while True:
                b, info = q.get()
                if not b:
                    return
                yield b, info
        finally:
            self.audioQueues.remove(q)

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

        port = await self.subServer if substream else await self.mainServer
        audioPort = await self.audioServer

        class Protocol:
            def __init__(self, pt: int) -> None:
                self.pt = pt

            def connection_made(self, transport):
                self.transport = transport

            def datagram_received(self, data, addr):
                l = len(data)
                len_data = struct.pack(">H", l)
                writer.write(len_data)
                writer.write(data)

        ffmpeg = await scrypted_sdk.mediaManager.getFFmpegPath()
        loop = asyncio.get_event_loop()

        vt, vp = await loop.create_datagram_endpoint(
            lambda: Protocol(96), local_addr=("127.0.0.1", 0)
        )
        vhost, vport = vt._sock.getsockname()

        vprocess = subprocess.Popen(
            [
                ffmpeg,
                "-analyzeduration",
                "0",
                "-probesize",
                "100k",
                "-f",
                "h264",
                "-i",
                f"tcp://127.0.0.1:{port}",
                "-vcodec",
                "copy",
                "-an",
                "-f",
                "rtp",
                "-payload_type",
                "96",
                f"rtp://127.0.0.1:{vport}?pkt_size=1300",
            ]
        )

        at, ap = await loop.create_datagram_endpoint(
            lambda: Protocol(97), local_addr=("127.0.0.1", 0)
        )

        ahost, aport = at._sock.getsockname()

        aprocess = subprocess.Popen(
            [
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
                f"tcp://127.0.0.1:{audioPort}",
                "-acodec",
                "copy",
                "-vn",
                "-f",
                "rtp",
                "-payload_type",
                "97",
                f"rtp://127.0.0.1:{aport}?pkt_size=1300",
            ]
        )

        try:
            while True:
                buffer = await reader.read()
                if not len(buffer):
                    return
        except Exception as e:
            traceback.print_exception(e)
        finally:
            self.print("rfc reader closed")

            # aprocess.stdin.write("q\n")
            aprocess.terminate()

            # vprocess.stdin.write("q\n")
            vprocess.terminate()

    async def handleAudioClient(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ):
        loop = asyncio.get_event_loop()
        closed = False
        q = queue.Queue()

        async def write():
            nonlocal closed
            d = q.get()
            if closed:
                pass
            if not d or closed:
                closed = True
                writer.close()
            else:
                writer.write(d)

        def run():
            try:
                for frame, frame_info in self.receiveAudioData():
                    if closed:
                        return
                    q.put(frame)
                    asyncio.run_coroutine_threadsafe(write(), loop=loop)

            except Exception as e:
                traceback.print_exception(e)
            finally:
                self.print("audio session closed")
                q.put(None)

        thread = threading.Thread(target=run)
        thread.start()

        try:
            while True:
                buffer = await reader.read()
                if not len(buffer):
                    return
        except Exception as e:
            traceback.print_exception(e)
        finally:
            self.print("audio reader closed")
            closed = True

    async def handleClient(
        self,
        account: wyzecam.WyzeAccount,
        frameSize,
        bitrate,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ):
        loop = asyncio.get_event_loop()
        closed = False
        q = queue.Queue()

        async def write():
            nonlocal closed
            d = q.get()
            if closed:
                pass
            if not d or closed:
                closed = True
                writer.close()
            else:
                writer.write(d)

        s = wyzecam.WyzeIOTCSession(
            self.plugin.wyze_iotc.tutk_platform_lib,
            account,
            self.camera,
            frame_size=frameSize,
            bitrate=bitrate,
            # CONNECTING?
            stream_state=c_int(2),
        )

        self.streams.add(s)
        startedAudio = False
        if not self.activeStream:
            self.activeStream = s

        def runAudio():
            for frame, frame_info in s.recv_audio_data():
                for q in self.audioQueues:
                    q.put((frame, frame_info))

        def checkStartAudio():
            nonlocal startedAudio
            if not startedAudio and self.activeStream == s:
                startedAudio = True
                thread = threading.Thread(target=runAudio)
                thread.start()

        def run():
            try:
                with s as sess:
                    checkStartAudio()
                    for frame, frame_info in sess.recv_video_data():
                        if closed:
                            return
                        q.put(frame)
                        asyncio.run_coroutine_threadsafe(write(), loop=loop)
                        checkStartAudio()

            except Exception as e:
                traceback.print_exception(e)
            finally:
                self.print("session closed")
                q.put(None)

        thread = threading.Thread(target=run)
        thread.start()

        try:
            while True:
                buffer = await reader.read()
                if not len(buffer):
                    return
        except Exception as e:
            traceback.print_exception(e)
        finally:
            self.streams.remove(s)
            if self.activeStream == s:
                # promote new audio stream to active
                self.activeStream = None
                for next in self.streams:
                    self.activeStream = next
                    break
            self.print("reader closed")
            closed = True

    async def ensureServer(self, cb) -> int:
        server = await asyncio.start_server(cb, "127.0.0.1", 0)
        sock = server.sockets[0]
        host, port = sock.getsockname()
        asyncio.ensure_future(server.serve_forever())
        return port

    def probeCodec(self, account, frameSize, bitrate):
        with wyzecam.WyzeIOTCSession(
            self.plugin.wyze_iotc.tutk_platform_lib,
            account,
            self.camera,
            frame_size=frameSize,
            bitrate=bitrate,
            # CONNECTING?
            stream_state=c_int(2),
        ) as sess:
            audioCodec = sess.get_audio_codec()
            for data, frame_info in sess.recv_video_data():
                nals = data.split(b"\x00\x00\x00\x01")
                sps = nals[1]
                pps = nals[2]
                return audioCodec + (sps, pps)

    def probeMainCodec(self):
        return self.probeCodec(
            self.plugin.account.model_copy(),
            FRAME_SIZE_1080P,
            BITRATE_HD,
        )

    def probeSubCodec(self):
        account = self.plugin.account.model_copy()
        account.phone_id = account.phone_id[2:]
        return self.probeCodec(
            account,
            FRAME_SIZE_360P,
            BITRATE_360P,
        )

    async def getVideoStream(
        self, options: RequestMediaStreamOptions = None
    ) -> Coroutine[Any, Any, MediaObject]:
        substream = options and options.get("id") == "substream"

        if substream:
            if not self.sub:
                codec, sampleRate, sps, pps = await to_thread(self.probeSubCodec)
                self.sub = CodecInfo("h264", (sps, pps), codec, sampleRate)
            info = self.sub

        if not substream:
            if not self.main:
                codec, sampleRate, sps, pps = await to_thread(self.probeMainCodec)
                self.main = CodecInfo("h264", (sps, pps), codec, sampleRate)
            info = self.main

        port = await self.subServer if substream else await self.mainServer
        audioPort = await self.audioServer
        rfcPort = await self.rfcSubServer if substream else await self.rfcServer

        msos = self.getVideoStreamOptionsInternal()
        mso = msos[1] if substream else msos[0]
        mso["audio"]["sampleRate"] = info.audioSampleRate

        if True:
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
m=audio 0 RTP/AVP 97
c=IN IP4 0.0.0.0
b=AS:128
a=rtpmap:97 {audioCodecName}/{info.audioSampleRate}/1
"""
            rfc = {
                "url": f"tcp://127.0.0.1:{rfcPort}",
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

        ffmpegInput: scrypted_sdk.FFmpegInput = {
            "container": "ffmpeg",
            "mediaStreamOptions": mso,
            "inputArguments": [
                "-analyzeduration",
                "0",
                "-probesize",
                "100k",
                "-f",
                "h264",
                "-i",
                f"tcp://127.0.0.1:{port}",
                "-f",
                info.audioCodec,
                "-ar",
                f"{info.audioBitrate}",
                "-ac",
                "1",
                "-i",
                f"tcp://127.0.0.1:{audioPort}",
            ],
        }
        mo = await scrypted_sdk.mediaManager.createFFmpegMediaObject(
            ffmpegInput,
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
                    "width": 1920,
                    "height": 1080,
                },
                "audio": {},
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
                "audio": {},
            }
        )
        return ret

    async def getVideoStreamOptions(self) -> list[ResponseMediaStreamOptions]:
        return self.getVideoStreamOptionsInternal()


class WyzePlugin(scrypted_sdk.ScryptedDeviceBase, DeviceProvider):
    cameras: Dict[str, wyzecam.WyzeCamera]
    account: wyzecam.WyzeAccount
    tutk_platform_lib: str

    def __init__(self):
        super().__init__()
        self.cameras = {}
        self.account = None

        if sys.platform != "linux":
            self.print("Wyze plugin must be installed under Scrypted for Linux.")
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
        self.account = wyzecam.get_user_info(auth_info)
        cameras = wyzecam.get_camera_list(auth_info)
        manifest: scrypted_sdk.DeviceManifest = {"devices": []}
        for camera in cameras:
            self.cameras[camera.p2p_id] = camera

            interfaces: List[ScryptedInterface] = [
                ScryptedInterface.VideoCamera.value,
            ]
            if "pan" in camera.model_name.lower():
                interfaces.append(ScryptedInterface.PanTiltZoom.value)

            device: scrypted_sdk.Device = {
                "nativeId": camera.p2p_id,
                "type": ScryptedDeviceType.Camera.value,
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
