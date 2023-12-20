from __future__ import annotations
from typing import Any, Coroutine, List, Dict
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

os.environ["TUTK_PROJECT_ROOT"] = os.path.join(os.environ["SCRYPTED_PLUGIN_VOLUME"], "zip/unzipped/fs")
sdkKey = 'AQAAAIZ44fijz5pURQiNw4xpEfV9ZysFH8LYBPDxiONQlbLKaDeb7n26TSOPSGHftbRVo25k3uz5of06iGNB4pSfmvsCvm/tTlmML6HKS0vVxZnzEuK95TPGEGt+aE15m6fjtRXQKnUav59VSRHwRj9Z1Kjm1ClfkSPUF5NfUvsb3IAbai0WlzZE1yYCtks7NFRMbTXUMq3bFtNhEERD/7oc504b'

class WyzeCamera(scrypted_sdk.ScryptedDeviceBase, VideoCamera):
    camera: wyzecam.WyzeCamera
    plugin: WyzePlugin

    def __init__(self, nativeId: str | None, plugin: WyzePlugin, camera: wyzecam.WyzeCamera):
        super().__init__(nativeId=nativeId)
        self.plugin = plugin
        self.camera = camera

        self.mainServer = asyncio.ensure_future(self.ensureServer(self.handleClient))
        self.subServer = asyncio.ensure_future(self.ensureServer(self.handleClient))

    async def handleClient(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        loop = asyncio.get_event_loop()
        closed = False
        q = queue.Queue()

        async def write():
            d = q.get()
            if not d:
                writer.close()
            else:
                writer.write(d)

        def run():
            try:
                with wyzecam.WyzeIOTC(tutk_platform_lib=self.plugin.tutk_platform_lib, sdk_key=sdkKey) as wyze_iotc:
                    with wyze_iotc.connect_and_auth(self.plugin.account, self.camera) as sess:
                        for frame, frame_info in sess.recv_video_data():
                            if closed:
                                return
                            q.put(frame)
                            asyncio.run_coroutine_threadsafe(write(), loop=loop)
            except Exception as e:
                traceback.print_exception(e)
            finally:
                q.put(None)

        thread = threading.Thread(target=run)
        thread.start()

        try:
            while True:
                await reader.read()
        except Exception as e:
            traceback.print_exception(e)
        finally:
            closed = True

    async def ensureServer(self, cb):
        server = await asyncio.start_server(cb, "127.0.0.1", 0)
        sock = server.sockets[0]
        host, port = sock.getsockname()
        return port
    async def getVideoStream(self, options: RequestMediaStreamOptions = None) -> Coroutine[Any, Any, MediaObject]:
        port = await self.mainServer
        ffmpegInput: scrypted_sdk.FFmpegInput = {
            "container": "ffmpeg",
            "inputArguments": [
                "-f", "h264",
                "-i", f"tcp://127.0.0.1:{port}",
            ]
        }
        mo = await scrypted_sdk.mediaManager.createFFmpegMediaObject(ffmpegInput, {
            "sourceId": self.id,
        })
        return mo

        return None

    async def getVideoStreamOptions(self) -> list[ResponseMediaStreamOptions]:
        ret: List[ResponseMediaStreamOptions] = []
        ret.append(
            {
                'id': 'main',
                'name': 'Main Stream',
                'video': {
                    'width': 1920,
                    'height': 1080,
                }
            }
        )
        # not all wyze can substream, need to create an exhaustive list?
        # wyze pan v2 does not, for example. others seem to set can_substream to False,
        # but DO actually support it
        ret.append(
            {
                'id': 'main',
                'name': 'Substream',
                'video': {
                    'width': 640,
                    'height': 360,
                }
            }
        )
        return ret


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
        manifest: scrypted_sdk.DeviceManifest = {
            'devices': []
        }
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

            manifest['devices'].append(device)

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
