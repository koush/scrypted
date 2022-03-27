
import scrypted_sdk
from scrypted_sdk.types import Camera, VideoCamera, ScryptedMimeTypes

from .arlo.arlo_async import TIMEOUT
from .logging import getLogger

logger = getLogger(__name__)

class ArloCamera(scrypted_sdk.ScryptedDeviceBase, Camera, VideoCamera):
    nativeId = None
    arlo_device = None
    provider = None

    def __init__(self, nativeId, arlo_device, provider):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.provider = provider

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        logger.debug(f"ArloCamera.takePicture nativeId={self.nativeId} options={options}")

        logger.info(f"Taking remote snapshot for {self.nativeId}")
        picUrl = await self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_device, self.arlo_device)

        if picUrl is None:
            logger.warn(f"Error taking snapshot for {self.nativeId}")
            raise Exception(f"Error taking snapshot for {self.nativeId}")
        elif picUrl is TIMEOUT:
            logger.warn(f"Timeout taking snapshot for {self.nativeId}")
            raise Exception(f"Timeout taking snapshot for {self.nativeId}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(picUrl), ScryptedMimeTypes.Url.value)

    async def getVideoStreamOptions(self):
        return []

    async def getVideoStream(self, options=None):
        logger.debug(f"ArloCamera.getVideoStream nativeId={self.nativeId} options={options}")

        rtspUrl = self.provider.arlo.StartStream(self.arlo_device, self.arlo_device)
        logger.info(f"Got stream for {self.nativeId} at {rtspUrl}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtspUrl), ScryptedMimeTypes.Url.value)