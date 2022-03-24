import aiohttp
import asyncio
import cv2
import json
import os
import shutil
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
    snapshot_interval = 60 * 15 # every 15 min

    def __init__(self, nativeId, arlo_device, provider):
        super().__init__(nativeId=nativeId)

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.provider = provider

        async def cacheImage(self):
            picUrl = arlo_device["presignedFullFrameSnapshotUrl"]

            logger.info(f"Downloading snapshot for {self.nativeId} from {picUrl}")
            async with aiohttp.ClientSession() as session:
                async with session.get(picUrl) as resp:
                    picBytes = await resp.read()
            logger.info(f"Done downloading snapshot for {self.nativeId}")

            self.cached_image = picBytes
            self.cached_time = time.time()
        asyncio.get_event_loop().create_task(cacheImage(self))

        asyncio.get_event_loop().create_task(self.takePicturePeriodic(sleepFirst=False))

    @property
    def is_streaming(self):
        return self.rtsp_proxy is not None

    async def takePicturePeriodic(self, sleepFirst=True):
        async def doTask(self, doSleep):
            if doSleep:
                await asyncio.sleep(self.snapshot_interval)
            try:
                logger.info(f"Taking periodic snapshot for {self.nativeId}")
                await self.takePicture(remote=True)
            except Exception as e:
                logger.warn(f"Could not take periodic snapshot for {self.nativeId}: {type(e)} {str(e)}") 
            asyncio.get_event_loop().create_task(doTask(self, True))
        asyncio.get_event_loop().create_task(doTask(self, sleepFirst))

    def takePictureCV(self, rtspUrl):
        logger.info(f"Capturing snapshot for {self.nativeId} from ongoing stream")
        with tempfile.TemporaryDirectory() as temp_dir:
            out = os.path.join(temp_dir, "image.jpeg")

            cap = cv2.VideoCapture(rtspUrl)
            _, frame = cap.read()
            cap.release()
            cv2.imwrite(out, frame)

            picBytes = open(out, 'rb').read()
        logger.info(f"Done capturing stream snapshot for {self.nativeId}")
        return picBytes

    async def getPictureOptions(self):
        return []

    async def takePicture(self, options=None, remote=False):
        logger.debug(f"ArloCamera.takePicture nativeId={self.nativeId} options={options}")

        if self.is_streaming and time.time() - self.cached_time >= 5:
            try:
                picBytes = self.takePictureCV(self.rtsp_proxy.proxy_url)
                self.cached_time = time.time()
            except Exception as e:
                logger.warn(f"Got exception capturing snapshot from stream: {str(e)}, using cached")
                picBytes = self.cached_image
        elif not self.is_streaming and remote:
            logger.info(f"Taking remote snapshot for {self.nativeId}")
            async with self.provider.arlo as arlo:
                picUrl = arlo.TriggerFullFrameSnapshot(self.arlo_device, self.arlo_device)
            await asyncio.sleep(0)

            logger.info(f"Downloading snapshot for {self.nativeId} from {picUrl}")
            async with aiohttp.ClientSession() as session:
                async with session.get(picUrl) as resp:
                    picBytes = await resp.read()
            logger.info(f"Done downloading snapshot for {self.nativeId}") 
        else:
            logger.info(f"Using cached image for {self.nativeId}")
            picBytes = self.cached_image

        self.cached_image = picBytes
        return await scrypted_sdk.mediaManager.createMediaObject(picBytes, "image/jpeg")

    async def getVideoStreamOptions(self):
        return []

    async def getVideoStream(self, options=None):
        logger.debug(f"ArloCamera.getVideoStream nativeId={self.nativeId} options={options}")

        if self.rtsp_proxy is None:
            async with self.provider.arlo as arlo:
                rtspUrl = arlo.StartStream(self.arlo_device, self.arlo_device)

            logger.info(f"Got stream for {self.nativeId} at {rtspUrl}")

            def startMultiplexer():
                return Popen([
                    shutil.which("live555ProxyServer"),
                    #"-V",
                    "-t",
                    "-p", f"{getNextProxyPort()}",
                    rtspUrl
                ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

            multiplexer = startMultiplexer()
            current_loop = asyncio.get_event_loop()
            async def stopStream(self):
                logger.info(f"Stopping stream for {self.nativeId}")
                async with self.provider.arlo as arlo:
                    arlo.StopStream(self.arlo_device, self.arlo_device)
            def onMonitorExit():
                nonlocal multiplexer
                multiplexer.kill()
                self.rtsp_proxy = None
                current_loop.call_soon_threadsafe(stopStream, self)

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
                        elif line.find("RTCPInstance error") != -1:
                            multiplexer.kill()
                            multiplexer = startMultiplexer()
                            exitLoop = False
                            break
                    if exitLoop:
                        break

            stdoutReader = threading.Thread(target=readStdout)
            stdoutReader.setDaemon(True)
            stdoutReader.start()

            # waiting for the proxy process to start up
            while not isReady:
                await asyncio.sleep(1)

            # it takes additional time for proxy to warm up, so check here
            maxRetries = 20
            retries = 0
            while True:
                cap = cv2.VideoCapture(liveUrl)
                retries += 1

                try:   
                    # Check if camera opened successfully
                    if (cap.isOpened() == True):
                        cap.release()
                        break
                except:
                    pass

                if retries >= maxRetries:
                    multiplexer.kill()
                    raise Exception("Max retries exceeded while waiting for RTSP proxy")
                await asyncio.sleep(1)

            async def cachePic(self):
                try:
                    picBytes = self.takePictureCV(liveUrl)
                    self.cached_image = picBytes
                    self.cached_time = time.time()
                except Exception as e:
                    logger.warn(f"Got exception capturing snapshot from stream: {str(e)}")

            asyncio.get_event_loop().create_task(cachePic(self))

            self.rtsp_proxy = RtspArloMonitor(liveUrl)
            self.rtsp_proxy.run_threaded(onMonitorExit)
        else:
            logger.debug(f"Reusing existing RTSP monitor at {self.rtsp_proxy.proxy_url}")

        return await scrypted_sdk.mediaManager.createMediaObject(str.encode(self.rtsp_proxy.proxy_url), ScryptedMimeTypes.Url.value)