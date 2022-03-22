import json
import os
import subprocess
from subprocess import call, Popen
import tempfile
import threading
import time
import urllib.request

import scrypted_sdk
from scrypted_sdk.types import Camera, VideoCamera, ScryptedMimeTypes

from .logging import getLogger
from .rtsp_monitor import RtspArloMonitor
from .scrypted_env import getPluginInstallDirectory

logger = getLogger(__name__)

nextPort = 15000
def getNextProxyPort():
    global nextPort
    port = nextPort
    nextPort += 1
    return port

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
                        "-hide_banner",
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

            def startMultiplexer():
                return Popen([
                    os.path.join(getPluginInstallDirectory(), "live555ProxyServer"),
                    "-t",
                    "-p", f"{getNextProxyPort()}",
                    rtspUrl
                ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

            multiplexer = startMultiplexer()
            def onMonitorExit():
                multiplexer.kill()
                self.rtsp_proxy = None

            isReady = False
            liveUrl = None

            def readStdout():
                nonlocal multiplexer
                nonlocal isReady
                nonlocal liveUrl
                while True:
                    exitLoop = True
                    for line in multiplexer.stdout:
                        line = line.decode("utf-8").rstrip()
                        print(line)
                        if not isReady:
                            if line.find("Play this stream using the URL") != -1:
                                liveUrl = line.split()[-1]
                                isReady = True
                            elif line.find("Address already in use") != -1:
                                multiplexer.kill()
                                multiplexer = startMultiplexer()
                                exitLoop = False
                                break
                    if exitLoop:
                        break

            stdoutReader = threading.Thread(target=readStdout)
            stdoutReader.setDaemon(True)
            stdoutReader.start()

            while not isReady:
                time.sleep(1)

            # additional waiting for the proxy to actually acquire the stream
            # this could probably be replaced by a dynamic readiness probe
            time.sleep(5)

            self.rtsp_proxy = RtspArloMonitor(liveUrl, self.provider, self.arlo_device)
            self.rtsp_proxy.run_threaded(onMonitorExit)
        else:
            logger.debug(f"Reusing existing RTSP monitor at {self.rtsp_proxy.proxy_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(self.rtsp_proxy.proxy_url), ScryptedMimeTypes.Url.value)