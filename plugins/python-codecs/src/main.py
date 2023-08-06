import traceback
import asyncio
import scrypted_sdk
from scrypted_sdk import Setting, SettingValue
from typing import Any, List, Union
import gstreamer
import libav
import vipsimage
import pilimage
import time
import zygote

Gst = None
try:
    from gi.repository import Gst
except:
    pass

av = None
try:
    import av
except:
    pass


class LibavGenerator(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.VideoFrameGenerator):
    def __init__(self, nativeId: Union[str, None], z):
        super().__init__(nativeId)
        self.zygote = z

    async def generateVideoFrames(
        self,
        mediaObject: scrypted_sdk.MediaObject,
        options: scrypted_sdk.VideoFrameGeneratorOptions = None,
        filter: Any = None,
    ) -> scrypted_sdk.VideoFrame:
        forked: CodecFork = await self.zygote().result
        return await forked.generateVideoFramesLibav(mediaObject, options, filter)


class GstreamerGenerator(
    scrypted_sdk.ScryptedDeviceBase,
    scrypted_sdk.VideoFrameGenerator,
    scrypted_sdk.Settings,
):
    def __init__(self, nativeId: Union[str, None], z):
        super().__init__(nativeId)
        self.zygote = z

    async def generateVideoFrames(
        self,
        mediaObject: scrypted_sdk.MediaObject,
        options: scrypted_sdk.VideoFrameGeneratorOptions = None,
        filter: Any = None,
    ) -> scrypted_sdk.VideoFrame:
        start = time.time()
        forked: CodecFork = await self.zygote().result
        print("fork", time.time() - start)
        return await forked.generateVideoFramesGstreamer(
            mediaObject,
            options,
            filter,
            self.storage.getItem("h264Decoder"),
            self.storage.getItem("postProcessPipeline"),
        )

    async def getSettings(self) -> List[Setting]:
        return [
            {
                "key": "h264Decoder",
                "title": "H264 Decoder",
                "description": "The Gstreamer pipeline to use to decode H264 video.",
                "value": self.storage.getItem("h264Decoder") or "Default",
                "choices": [
                    "Default",
                    "decodebin",
                    "vtdec_hw",
                    "nvh264dec",
                    "vaapih264dec",
                ],
                "combobox": True,
            },
            {
                "key": "postProcessPipeline",
                "title": "Post Process Pipeline",
                "description": "The Gstreamer pipeline to use to resize and scale frames.",
                "value": self.storage.getItem("postProcessPipeline") or "Default",
                "choices": [
                    "Default",
                    "OpenGL (GPU memory)",
                    "OpenGL (system memory)",
                    "VAAPI",
                ],
            },
        ]

    async def putSetting(self, key: str, value: SettingValue) -> None:
        self.storage.setItem(key, value)
        await scrypted_sdk.deviceManager.onDeviceEvent(
            self.nativeId, scrypted_sdk.ScryptedInterface.Settings.value, None
        )


class PythonCodecs(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.DeviceProvider):
    def __init__(self, nativeId=None):
        super().__init__(nativeId)

        self.zygote = None
        asyncio.ensure_future(self.initialize())

    async def initialize(self):
        manifest: scrypted_sdk.DeviceManifest = {
            "devices": [],
        }
        if Gst:
            gstDevice: scrypted_sdk.Device = {
                "name": "Gstreamer",
                "nativeId": "gstreamer",
                "interfaces": [
                    scrypted_sdk.ScryptedInterface.VideoFrameGenerator.value,
                    scrypted_sdk.ScryptedInterface.Settings.value,
                ],
                "type": scrypted_sdk.ScryptedDeviceType.API.value,
            }
            manifest["devices"].append(gstDevice)

        if av:
            avDevice: scrypted_sdk.Device = {
                "name": "Libav",
                "nativeId": "libav",
                "interfaces": [
                    scrypted_sdk.ScryptedInterface.VideoFrameGenerator.value,
                ],
                "type": scrypted_sdk.ScryptedDeviceType.API.value,
            }
            manifest["devices"].append(avDevice)

        manifest["devices"].append(
            {
                "name": "Image Reader",
                "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                "nativeId": "reader",
                "interfaces": [
                    scrypted_sdk.ScryptedInterface.BufferConverter.value,
                ],
            }
        )

        manifest["devices"].append(
            {
                "name": "Image Writer",
                "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                "nativeId": "writer",
                "interfaces": [
                    scrypted_sdk.ScryptedInterface.BufferConverter.value,
                ],
            }
        )

        await scrypted_sdk.deviceManager.onDevicesChanged(manifest)

    def getDevice(self, nativeId: str) -> Any:
        if not self.zygote:
            self.zygote = zygote.createZygote()

        if nativeId == "gstreamer":
            return GstreamerGenerator("gstreamer", self.zygote)
        if nativeId == "libav":
            return LibavGenerator("libav", self.zygote)

        if vipsimage.pyvips:
            if nativeId == "reader":
                return vipsimage.ImageReader("reader")
            if nativeId == "writer":
                return vipsimage.ImageWriter("writer")
        else:
            if nativeId == "reader":
                return pilimage.ImageReader("reader")
            if nativeId == "writer":
                return pilimage.ImageWriter("writer")


def create_scrypted_plugin():
    return PythonCodecs()


def multiprocess_exit():
    import sys

    if sys.platform == "win32":
        sys.exit()
    else:
        import os

        os._exit(os.EX_OK)


class CodecFork:
    async def generateVideoFrames(self, iter, src: str, firstFrameOnly=False):
        start = time.time()
        loop = asyncio.get_event_loop()

        def timeoutExit():
            print("Frame yield timed out, exiting pipeline.")
            multiprocess_exit()

        try:
            while True:
                data = await asyncio.wait_for(iter.__anext__(), timeout=10)
                timeout = loop.call_later(10, timeoutExit)
                yield data
                timeout.cancel()
                if firstFrameOnly:
                    break
        except Exception:
            traceback.print_exc()
            raise
        finally:
            print("%s finished after %s" % (src, time.time() - start))
            asyncio.get_event_loop().call_later(1, multiprocess_exit)

    async def generateVideoFramesGstreamer(
        self,
        mediaObject: scrypted_sdk.MediaObject,
        options: scrypted_sdk.VideoFrameGeneratorOptions,
        filter: Any,
        h264Decoder: str,
        postProcessPipeline: str,
    ) -> scrypted_sdk.VideoFrame:
        async for data in self.generateVideoFrames(
            gstreamer.generateVideoFramesGstreamer(
                mediaObject, options, filter, h264Decoder, postProcessPipeline
            ),
            "gstreamer",
            options and options.get("firstFrameOnly"),
        ):
            yield data

    async def generateVideoFramesLibav(
        self,
        mediaObject: scrypted_sdk.MediaObject,
        options: scrypted_sdk.VideoFrameGeneratorOptions = None,
        filter: Any = None,
    ) -> scrypted_sdk.VideoFrame:
        async for data in self.generateVideoFrames(
            libav.generateVideoFramesLibav(mediaObject, options, filter),
            "libav",
            options and options.get("firstFrameOnly"),
        ):
            yield data


async def fork():
    return CodecFork()
