import asyncio
from re import X
from venv import create

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Camera, VideoCamera, MotionSensor, Online, Battery, ScryptedMimeTypes

from .logging import ScryptedDeviceLoggerMixin

class ArloCamera(ScryptedDeviceBase, Camera, VideoCamera, MotionSensor, Battery, ScryptedDeviceLoggerMixin):
    nativeId = None
    arlo_device = None
    arlo_basestation = None
    provider = None

    def __init__(self, nativeId, arlo_device, arlo_basestation, provider):
        super().__init__(nativeId=nativeId)
        self.logger_name = "ArloCamera"

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo_basestation = arlo_basestation
        self.provider = provider
        self.logger.setLevel(self.provider.get_current_log_level())

        self.motionDetected = arlo_device["properties"].get("motionDetected", False)
        #self.online = arlo_device["properties"].get("connectionState") == "available" # TODO
        self.batteryLevel = arlo_device["properties"].get("batteryLevel") # TODO update this

        self.stop_motion_subscription = False
        self.start_motion_subscription()

    def __del__(self):
        self.stop_motion_subscription = True

    def start_motion_subscription(self):
        def callback(motionDetected):
            self.motionDetected = motionDetected
            return self.stop_motion_subscription

        self.provider.arlo.SubscribeToMotionEvents(self.arlo_basestation, self.arlo_device, callback)

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        self.logger.info(f"Taking picture for {self.nativeId}")

        pic_url = await asyncio.wait_for(self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_basestation, self.arlo_device), timeout=10)
        self.logger.debug(f"Got snapshot URL for {self.nativeId} at {pic_url}")

        if pic_url is None:
            raise Exception(f"Error taking snapshot for {self.nativeId}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(pic_url), ScryptedMimeTypes.Url.value)

    async def getVideoStreamOptions(self):
        return [
            {
                "id": 'default',
                "name": 'Cloud RTSP',
                "container": 'rtsp',
                "video": {
                    "codec": 'h264',
                },
                "audio": {
                    "codec": 'aac',
                },
                "source": 'cloud',
                "tool": 'scrypted',
                "userConfigurable": False,
            }
        ]

    async def getVideoStream(self, options=None):
        self.logger.info(f"Requesting stream for {self.nativeId}")

        rtsp_url = await asyncio.wait_for(self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device), timeout=10)
        self.logger.debug(f"Got stream URL for {self.nativeId} at {rtsp_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtsp_url), ScryptedMimeTypes.Url.value)