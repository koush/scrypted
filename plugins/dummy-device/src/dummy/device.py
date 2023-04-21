from typing import List

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import (
    ScryptedInterface,
    ScryptedDeviceType,
    MediaObject,
    FFmpegInput,
    Settings,
    Setting,
    SettingValue,
    Camera,
    ResponsePictureOptions,
    RequestPictureOptions,
    VideoCamera,
    ResponseMediaStreamOptions,
    RequestMediaStreamOptions,
    Battery,
    Charger,
    ChargeState,
)


SUPPORTED_INTERFACES = [
    ScryptedInterface.Camera.value,
    ScryptedInterface.VideoCamera.value,
    ScryptedInterface.Battery.value,
    ScryptedInterface.Charger.value,
]

SUPPORTED_TYPES = [
    ScryptedDeviceType.Camera.value,
]


class DummyDevice(ScryptedDeviceBase, Settings, Camera, VideoCamera, Battery, Charger):
    @property
    def picture_url(self):
        return self.storage.getItem("picture_url")

    @property
    def video_url(self):
        return self.storage.getItem("video_url")

    async def getSettings(self) -> List[Setting]:
        settings: List[Setting] = [
            {
                "group": "General",
                "key": "interfaces",
                "title": "Scrypted Interfaces",
                "description": "Choice of the supported Scrypted interfaces that this device should implement.",
                "value": self.providedInterfaces,
                "choices": SUPPORTED_INTERFACES,
                "multiple": True,
            }
        ]

        if ScryptedInterface.Camera.value in self.interfaces:
            settings.extend([
                {
                    "group": ScryptedInterface.Camera.value,
                    "key": "storage:picture_url",
                    "title": "Picture URL",
                    "description": "Media URL to use as the snapshot picture. Can be either a static image or a video stream.",
                    "value": self.picture_url,
                }
            ])
        if ScryptedInterface.VideoCamera.value in self.interfaces:
            settings.extend([
                {
                    "group": ScryptedInterface.VideoCamera.value,
                    "key": "storage:video_url",
                    "title": "Video URL",
                    "description": "Media URL to use as the video stream.",
                    "value": self.video_url,
                }
            ])
        if ScryptedInterface.Battery.value in self.interfaces:
            settings.extend([
                {
                    "group": ScryptedInterface.Battery.value,
                    "key": "batteryLevel",
                    "title": "Battery Level",
                    "description": "The device's battery percentage level, from 0 to 100.",
                    "value": self.batteryLevel,
                    "type": "number",
                }
            ])
        if ScryptedInterface.Charger.value in self.interfaces:
            settings.extend([
                {
                    "group": ScryptedInterface.Charger.value,
                    "key": "chargeState",
                    "title": "Charge State",
                    "description": "The device's charge state, one of the available options.",
                    "value": self.chargeState,
                    "choices": [c.value for c in ChargeState],
                }
            ])

        return settings

    async def putSetting(self, key: str, value: SettingValue) -> None:
        if key.startswith("storage:"):
            key = key.split(":")[1]
            self.storage.setItem(key, value)
        elif key == "interfaces":
            await scrypted_sdk.deviceManager.onDeviceDiscovered({
                "nativeId": self.nativeId,
                "name": self.name,
                "interfaces": value,
                "type": self.type,
            })
        else:
            setattr(self, key, value)
        await self.onDeviceEvent(ScryptedInterface.Settings.value, None)

    async def getPictureOptions(self) -> List[ResponsePictureOptions]:
        return []

    async def takePicture(self, options: RequestPictureOptions = None) -> MediaObject:
        if not self.picture_url:
            raise Exception("no picture url configured")
        return await scrypted_sdk.mediaManager.createMediaObjectFromUrl(self.picture_url)

    async def getVideoStreamOptions(self) -> List[ResponseMediaStreamOptions]:
        return [
            {
                "id": "default",
                "name": 'Dummy',
                "tool": 'ffmpeg',
            }
        ]

    async def getVideoStream(self, options: RequestMediaStreamOptions = None) -> MediaObject:
        if not self.video_url:
            raise Exception("no video url configured")

        arguments = ["-i", self.video_url]
        if not self.video_url.startswith("rtsp"):
            arguments = ["-re"] + arguments

        ffmpeg_input: FFmpegInput = {
            "url": self.video_url,
            "inputArguments": arguments,
        }
        return await scrypted_sdk.mediaManager.createFFmpegMediaObject(ffmpeg_input)