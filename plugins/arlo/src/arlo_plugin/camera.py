import urllib.request

import scrypted_sdk
from scrypted_sdk.types import Settings, Camera, VideoCamera, ScryptedMimeTypes

from .logging import getLogger

logger = getLogger(__name__)

class ArloCamera(scrypted_sdk.ScryptedDeviceBase, Camera, Settings):
    nativeId = None
    arlo_device = None
    provider = None

    def __init__(self, nativeId, arlo_device, provider):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.provider = provider

        # keepalive
        self.provider.arlo.Subscribe(self.arlo_device)

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        picUrl = self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_device, self.arlo_device)
        
        logger.info(f"Fetching Arlo snapshot for {self.nativeId} at {picUrl}")
        picBytes = urllib.request.urlopen(picUrl).read()
        logger.info(f"Done fetching for {self.nativeId}")

        return await scrypted_sdk.mediaManager.createMediaObject(picBytes, "image/jpeg")

