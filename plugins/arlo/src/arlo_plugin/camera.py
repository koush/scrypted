import json
import os
from subprocess import call
import tempfile
import time
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
    cached_image = None
    cached_time = None

    def __init__(self, nativeId, arlo_device, provider):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.provider = provider

    @property
    def is_streaming(self):
        return self.rtsp_proxy is not None

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None):
        logger.debug(f"ArloCamera.takePicture nativeId={self.nativeId} options={options}")

        if self.cached_image is not None and time.time() - self.cached_time < 30:
            logger.info(f"Using cached image for {self.nativeId}")
            return await scrypted_sdk.mediaManager.createMediaObject(self.cached_image, "image/jpeg")

        if self.is_streaming:
            try:
                logger.info(f"Capturing snapshot for {self.nativeId} from ongoing stream")
                with tempfile.TemporaryDirectory() as temp_dir:
                    out = os.path.join(temp_dir, "image.jpeg")
                    call([
                        await scrypted_sdk.mediaManager.getFFmpegPath(),
                        "-y",
                        "-rtsp_transport", "tcp",
                        "-i", self.rtsp_proxy.proxy_url,
                        "-frames:v", "1",
                        out 
                    ])
                    picBytes = open(out, 'rb').read()
                logger.info(f"Done capturing stream snapshot for {self.nativeId}")
            except Exception as e:
                logger.warn(f"Got exception capturing snapshot from stream: {str(e)}, using cached")
                return await scrypted_sdk.mediaManager.createMediaObject(self.cached_image, "image/jpeg")
        else:
            with self.provider.arlo as arlo:
                picUrl = arlo.TriggerFullFrameSnapshot(self.arlo_device, self.arlo_device) 

            logger.info(f"Downloading snapshot for {self.nativeId} from {picUrl}")
            picBytes = urllib.request.urlopen(picUrl).read()
            logger.info(f"Done downloading snapshot for {self.nativeId}")

        self.cached_image = picBytes
        self.cached_time = time.time()
        return await scrypted_sdk.mediaManager.createMediaObject(picBytes, "image/jpeg")

    async def getVideoStreamOptions(self):
        return []

    async def getVideoStream(self, options=None):
        logger.debug(f"ArloCamera.getVideoStream nativeId={self.nativeId} options={options}")

        if self.rtsp_proxy is None:
            with self.provider.arlo as arlo:
                rtspUrl = arlo.StartStream(self.arlo_device, self.arlo_device)

            logger.info(f"Got stream for {self.nativeId} at {rtspUrl}")

            def on_proxy_exit():
                self.rtsp_proxy = None

            self.rtsp_proxy = RtspArloProxy(rtspUrl, self.provider, self.arlo_device)
            self.rtsp_proxy.run_threaded(on_proxy_exit)
        else:
            logger.debug(f"Reusing existing RTSP proxy at {self.rtsp_proxy.proxy_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(self.rtsp_proxy.proxy_url), ScryptedMimeTypes.Url.value)