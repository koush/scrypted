from aiortc import RTCPeerConnection
from aiortc.contrib.media import MediaPlayer
import asyncio
import inspect
import threading
import logging
import queue
import sys


# construct logger instance to be used by BackgroundRTCPeerConnection
logger = logging.getLogger("rtc")
logger.setLevel(logging.INFO)

# output logger to stdout
ch = logging.StreamHandler(sys.stdout)

# log formatting
fmt = logging.Formatter("(arlo) %(levelname)s:%(name)s:%(asctime)s.%(msecs)03d %(message)s", "%H:%M:%S")
ch.setFormatter(fmt)

# configure handler to logger
logger.addHandler(ch)


class BackgroundRTCPeerConnection:
    """Proxy class to use RTCPeerConnection in a background thread.

    The purpose of this proxy is to ensure that RTCPeerConnection operations
    do not block the main asyncio thread. From testing, it seems that the
    close() function blocks until the source RTSP server exits, which we
    have no control over. Additionally, since asyncio coroutines are tied
    to the event loop they were constructed from, it is not possible to only
    run close() in a separate thread. Therefore, each instance of RTCPeerConnection
    is launched within its own ephemeral thread, which cleans itself up once
    close() completes.
    """

    def __init__(self):
        self.main_loop = asyncio.get_event_loop()
        self.background_loop = asyncio.new_event_loop()

        self.thread_started = queue.Queue(1)
        self.thread = threading.Thread(target=self.__background_main)
        self.thread.start()
        self.thread_started.get()

    def __background_main(self):
        logger.debug(f"Background RTC loop {self.thread.name} starting")
        self.pc = RTCPeerConnection()

        asyncio.set_event_loop(self.background_loop)
        self.thread_started.put(True)
        self.background_loop.run_forever()

        logger.debug(f"Background RTC loop {self.thread.name} exiting")

    async def __run_background(self, coroutine, await_result=True, stop_loop=False):
        fut = self.main_loop.create_future()

        def background_callback():
            # callback to run on main_loop.
            def to_main(result, is_error):
                if is_error:
                    fut.set_exception(result)
                else:
                    fut.set_result(result)

            # callback to run on background_loop., after the coroutine completes
            def callback(task):
                is_error = False
                if task.exception():
                    result = task.exception()
                    is_error = True
                else:
                    result = task.result()

                # send results to the main loop
                self.main_loop.call_soon_threadsafe(to_main, result, is_error)

                # stopping the loop here ensures that the coroutine completed
                # and doesn't raise any "task not awaited" exceptions
                if stop_loop:
                    self.background_loop.stop()

            task = self.background_loop.create_task(coroutine)
            task.add_done_callback(callback)

        # start the callback in the background loop
        self.background_loop.call_soon_threadsafe(background_callback)

        if not await_result:
            return None

        await fut
        if fut.exception():
            raise fut.exception()
        return fut.result()

    async def createOffer(self):
        return await self.__run_background(self.pc.createOffer())

    async def setLocalDescription(self, sdp):
        return await self.__run_background(self.pc.setLocalDescription(sdp))

    async def setRemoteDescription(self, sdp):
        return await self.__run_background(self.pc.setRemoteDescription(sdp))

    async def addIceCandidate(self, candidate):
        return await self.__run_background(self.pc.addIceCandidate(candidate))

    async def close(self):
        await self.__run_background(self.pc.close(), await_result=False, stop_loop=True)

    def add_rtsp_audio(self, rtsp_url):
        """Adds an audio track to the RTCPeerConnection given a source RTSP url.

        This constructs a MediaPlayer in the background thread's asyncio loop,
        since MediaPlayer also utilizes coroutines and asyncio.

        Note that this may block the background thread's event loop if the RTSP
        server is not yet ready.
        """
        def add_rtsp_audio_background():
            media_player = MediaPlayer(rtsp_url, format="rtsp")
            self.pc.addTrack(media_player.audio)

        self.background_loop.call_soon_threadsafe(add_rtsp_audio_background)