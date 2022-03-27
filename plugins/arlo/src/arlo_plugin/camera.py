import aiohttp
import asyncio

import scrypted_sdk
from scrypted_sdk.types import Camera, VideoCamera, ScryptedMimeTypes

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
            logger.warn(f"Cannot take snapshot for {self.nativeId}")
            raise Exception(f"Error taking snapshot for {self.nativeId}")
        else:
            logger.info(f"Downloading snapshot for {self.nativeId} from {picUrl}")
            async with aiohttp.ClientSession() as session:
                async with session.get(picUrl) as resp:
                    picBytes = await resp.read()
            logger.info(f"Done downloading snapshot for {self.nativeId}") 

        return await scrypted_sdk.mediaManager.createMediaObject(picBytes, "image/jpeg")

    async def getVideoStreamOptions(self):
        return []

    async def getVideoStream(self, options=None):
        logger.debug(f"ArloCamera.getVideoStream nativeId={self.nativeId} options={options}")

        rtspUrl = self.provider.arlo.StartStream(self.arlo_device, self.arlo_device)
        logger.info(f"Got stream for {self.nativeId} at {rtspUrl}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(rtspUrl), ScryptedMimeTypes.Url.value)