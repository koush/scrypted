import asyncio

import scrypted_sdk
from scrypted_sdk.types import Camera, VideoCamera, MotionSensor, Online, Battery, ScryptedMimeTypes

class ArloCamera(scrypted_sdk.ScryptedDeviceBase, Camera, VideoCamera, MotionSensor, Battery):
    nativeId = None
    arlo_device = None
    arlo_basestation = None
    provider = None

    def __init__(self, nativeId, arlo_device, arlo_basestation, provider):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo_basestation = arlo_basestation
        self.provider = provider

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
        self.print(f"ArloCamera.takePicture nativeId={self.nativeId} options={options}")

        self.print(f"Taking remote snapshot for {self.nativeId}")
        pic_url = await asyncio.wait_for(self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_basestation, self.arlo_device), timeout=10)

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
        self.print(f"ArloCamera.getVideoStream nativeId={self.nativeId} options={options}")

        rtsp_url = self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device)
        self.print(f"Got stream for {self.nativeId} at {rtsp_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtsp_url), ScryptedMimeTypes.Url.value)