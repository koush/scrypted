import urllib.request

import scrypted_sdk
from scrypted_sdk.types import Camera, VideoCamera, ScryptedMimeTypes

from .logging import getLogger

logger = getLogger(__name__)

class ArloCamera(scrypted_sdk.ScryptedDeviceBase, Camera, VideoCamera):
    nativeId = None
    arlo_device = None
    arlo = None

    def __init__(self, nativeId, arlo_device, arlo):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo = arlo

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        logger.debug("takePicture - options="+str(options))
        picUrl = self.arlo.TriggerFullFrameSnapshot(self.arlo_device, self.arlo_device)
        self.arlo.Unsubscribe()

        logger.info(f"Fetching Arlo snapshot for {self.nativeId} at {picUrl}")
        picBytes = urllib.request.urlopen(picUrl).read()
        logger.info(f"Done fetching for {self.nativeId}")

        return await scrypted_sdk.mediaManager.createMediaObject(picBytes, "image/jpeg")

    async def getVideoStreamOptions(self):
        return []

    async def getVideoStream(self, options=None):
        logger.debug("getVideoStream - options="+str(options))
        rtspUrl = self.arlo.StartStream(self.arlo_device, self.arlo_device)
        self.arlo.Unsubscribe()

        logger.info(f"Got Arlo stream for {self.nativeId} at {rtspUrl}")
        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtspUrl), ScryptedMimeTypes.Url.value)