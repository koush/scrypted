import asyncio
import time
import traceback
import os
from typing import Any, AsyncGenerator, List, Union

import scrypted_sdk
from scrypted_sdk import Setting, SettingValue

import gstreamer
import libav
import pilimage
import vipsimage
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
        # todo remove
        filter: Any = None,
    ) -> scrypted_sdk.VideoFrame:
        forked: CodecFork = await self.zygote().result
        return await forked.generateVideoFramesLibav(mediaObject, options)


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
        # todo remove
        filter: Any = None,
    ) -> scrypted_sdk.VideoFrame:
        start = time.time()
        forked: CodecFork = await self.zygote().result
        print("fork", time.time() - start)
        return await forked.generateVideoFramesGstreamer(
            mediaObject,
            options,
            self.storage.getItem("h264Decoder"),
            self.storage.getItem("h265Decoder"),
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
                "key": "h265Decoder",
                "title": "H25 Decoder",
                "description": "The Gstreamer pipeline to use to decode H265 video.",
                "value": self.storage.getItem("h265Decoder") or "Default",
                "choices": [
                    "Default",
                    "decodebin",
                    "vtdec_hw",
                    "nvh265dec",
                    "vaapih265dec",
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


def restart():
    asyncio.ensure_future(
        scrypted_sdk.deviceManager.requestRestart(), loop=asyncio.get_event_loop()
    )


class PythonCodecs(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.DeviceProvider):
    def __init__(self, nativeId=None):
        super().__init__(nativeId)

        self.zygote = None
        asyncio.ensure_future(self.initialize())

        # 8/30/2023 clear out process leaks on various systems that i can't track down.
        # 8/31/2023 this might be fixed.
        asyncio.get_event_loop().call_later(24 * 60 * 60, restart)

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
        else:
            if nativeId == "reader":
                return pilimage.ImageReader("reader")


def create_scrypted_plugin():
    return PythonCodecs()


def multiprocess_exit():
    os._exit(0)


class CodecFork:
    def timeoutExit(self):
        print("Frame yield timed out, exiting pipeline.")
        multiprocess_exit()

    async def generateVideoFrames(self, iter, src: str, firstFrameOnly=False):
        start = time.time()
        loop = asyncio.get_event_loop()

        try:
            while True:
                self.timeout.cancel()
                self.timeout = loop.call_later(10, self.timeoutExit)
                data = await asyncio.wait_for(iter.__anext__(), timeout=10)
                self.timeout.cancel()
                self.timeout = loop.call_later(10, self.timeoutExit)
                yield data

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
        h264Decoder: str,
        h265Decoder: str,
        postProcessPipeline: str,
    ) -> AsyncGenerator[scrypted_sdk.VideoFrame, Any]:
        loop = asyncio.get_event_loop()
        self.timeout = loop.call_later(10, self.timeoutExit)

        async for data in self.generateVideoFrames(
            gstreamer.generateVideoFramesGstreamer(
                mediaObject, options, h264Decoder, h265Decoder, postProcessPipeline
            ),
            "gstreamer",
            options and options.get("firstFrameOnly"),
        ):
            yield data

    async def generateVideoFramesLibav(
        self,
        mediaObject: scrypted_sdk.MediaObject,
        options: scrypted_sdk.VideoFrameGeneratorOptions = None,
    ) -> AsyncGenerator[scrypted_sdk.VideoFrame, Any]:
        loop = asyncio.get_event_loop()
        self.timeout = loop.call_later(10, self.timeoutExit)

        async for data in self.generateVideoFrames(
            libav.generateVideoFramesLibav(mediaObject, options),
            "libav",
            options and options.get("firstFrameOnly"),
        ):
            yield data


async def fork():
    return CodecFork()
