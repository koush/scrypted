import json
import urllib.request

import scrypted_sdk
from scrypted_sdk.types import Camera, VideoCamera, ScryptedMimeTypes

from .logging import getLogger
from .rtsp_proxy import RtspArloProxy

logger = getLogger(__name__)

class ArloCamera(scrypted_sdk.ScryptedDeviceBase, Camera, VideoCamera):
    nativeId = None
    arlo_device = None
    provider = None
    rtsp_proxy = None

    def __init__(self, nativeId, arlo_device, provider):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.provider = provider

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        logger.debug(f"ArloCamera.takePicture nativeId={self.nativeId} options={options}")

        with self.provider.arlo as arlo:
            picUrl = arlo.TriggerFullFrameSnapshot(self.arlo_device, self.arlo_device) 

        logger.info(f"Downloading Arlo snapshot for {self.nativeId} from {picUrl}")
        picBytes = urllib.request.urlopen(picUrl).read()
        logger.info(f"Done downloading snapshot for {self.nativeId}")

        return await scrypted_sdk.mediaManager.createMediaObject(picBytes, "image/jpeg")

    async def getVideoStreamOptions(self):
        return []

    async def getVideoStream(self, options=None):
        logger.debug(f"ArloCamera.getVideoStream nativeId={self.nativeId} options={options}")

        if self.rtsp_proxy is None:
            with self.provider.arlo as arlo:
                rtspUrl = arlo.StartStream(self.arlo_device, self.arlo_device)

            logger.info(f"Got Arlo stream for {self.nativeId} at {rtspUrl}")

            def on_proxy_exit():
                self.rtsp_proxy = None

            self.rtsp_proxy = RtspArloProxy(rtspUrl, self.provider, self.arlo_device)
            self.rtsp_proxy.run_threaded(on_proxy_exit)
        else:
            logger.debug(f"Reusing existing RTSP proxy at {self.rtsp_proxy.proxy_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(self.rtsp_proxy.proxy_url), ScryptedMimeTypes.Url.value)