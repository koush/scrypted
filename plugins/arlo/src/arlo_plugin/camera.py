
import scrypted_sdk
from scrypted_sdk.types import Camera, VideoCamera, ScryptedMimeTypes

from .arlo.arlo_async import TIMEOUT
from .logging import getLogger

logger = getLogger(__name__)

class ArloCamera(scrypted_sdk.ScryptedDeviceBase, Camera, VideoCamera):
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

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        logger.debug(f"ArloCamera.takePicture nativeId={self.nativeId} options={options}")

        logger.debug(f"Taking remote snapshot for {self.nativeId}")
        pic_url = await self.provider.arlo.TriggerFullFrameSnapshot(self.arlo_basestation, self.arlo_device)

        if pic_url is None:
            raise Exception(f"Error taking snapshot for {self.nativeId}")
        elif pic_url is TIMEOUT:
            raise Exception(f"Timeout taking snapshot for {self.nativeId}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(pic_url), ScryptedMimeTypes.Url.value)

    async def getVideoStreamOptions(self):
        return []

    async def getVideoStream(self, options=None):
        logger.debug(f"ArloCamera.getVideoStream nativeId={self.nativeId} options={options}")

        rtsp_url = self.provider.arlo.StartStream(self.arlo_basestation, self.arlo_device)
        logger.debug(f"Got stream for {self.nativeId} at {rtsp_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtsp_url), ScryptedMimeTypes.Url.value)