import asyncio

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Camera, VideoCamera, MotionSensor, Battery, Refresh, ScryptedMimeTypes

from .logging import ScryptedDeviceLoggerMixin

class ArloCamera(ScryptedDeviceBase, Camera, VideoCamera, MotionSensor, Battery, Refresh, ScryptedDeviceLoggerMixin):
    nativeId = None
    arlo_device = None
    arlo_basestation = None
    provider = None

    def __init__(self, nativeId, arlo_device, arlo_basestation, provider):
        super().__init__(nativeId=nativeId)
        self.logger_name = f"ArloCamera[{nativeId}]"

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo_basestation = arlo_basestation
        self.provider = provider
        self.logger.setLevel(self.provider.get_current_log_level())
        
        self.update_device_details(arlo_device)

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
        self.logger.info("Taking picture")

        real_device = await scrypted_sdk.systemManager.api.getDeviceById(self.deviceState._id)
        msos = await real_device.getVideoStreamOptions()
        if any(["prebuffer" in m for m in msos]):
            self.logger.info("Getting snapshot from prebuffer")
            return await real_device.getVideoStream({"refresh": False})

        pic_url = await asyncio.wait_for(self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_basestation, self.arlo_device), timeout=30)
        self.logger.debug(f"Got snapshot URL for at {pic_url}")

        if pic_url is None:
            raise Exception("Error taking snapshot")

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
                "audio": None if self.arlo_device.get("modelId") == "VMC3030" else {
                    "codec": 'aac',
                },
                "source": 'cloud',
                "tool": 'scrypted',
                "userConfigurable": False,
            }
        ]

    async def getVideoStream(self, options=None):
        self.logger.info("Requesting stream")

        rtsp_url = await asyncio.wait_for(self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device), timeout=30)
        self.logger.debug(f"Got stream URL at {rtsp_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtsp_url), ScryptedMimeTypes.Url.value)

    async def getRefreshFrequency(self):
        return 60

    async def refresh(self, refreshInterface, userInitiated):
        self.logger.info(f"{refreshInterface} requested refresh" + userInitiated * " (user initiated)")

        devices = self.provider.arlo.GetDevices('camera')
        arlo_device = None
        for device in devices:
            if device["deviceId"] == self.nativeId:
                arlo_device = device
                break

        if arlo_device is None:
            raise Exception(f"Device {self.nativeId} not found in GetDevices call to Arlo")

        self.update_device_details(arlo_device)
        self.arlo_device = arlo_device

    def update_device_details(self, arlo_device):
        self.batteryLevel = arlo_device["properties"].get("batteryLevel")