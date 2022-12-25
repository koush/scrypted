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

    async def __run_background(self, coro_name, *args, await_result=True, stop_loop=False):
        fut = self.main_loop.create_future()

        def background_callback():
            def to_main(result, is_error):
                if is_error:
                    fut.set_exception(result)
                else:
                    fut.set_result(result)

            def callback(task):
                is_error = False
                if task.exception():
                    result = task.exception()
                    is_error = True
                else:
                    result = task.result()
                self.main_loop.call_soon_threadsafe(to_main, result, is_error)

                if stop_loop:
                    self.background_loop.stop()

            coroutine = getattr(self.pc, coro_name)
            if not inspect.iscoroutinefunction(coroutine):
                # convert the normal function into a coroutine
                fn = coroutine
                async def coro(*args):
                    return fn(*args)
                coroutine = coro

            task = self.background_loop.create_task(coroutine(*args))
            task.add_done_callback(callback)

        self.background_loop.call_soon_threadsafe(background_callback)

        if not await_result:
            return None

        await fut
        if fut.exception():
            raise fut.exception()
        return fut.result()

    async def createOffer(self):
        return await self.__run_background("createOffer")

    async def setLocalDescription(self, sdp):
        return await self.__run_background("setLocalDescription", sdp)

    async def setRemoteDescription(self, sdp):
        return await self.__run_background("setRemoteDescription", sdp)

    async def addIceCandidate(self, candidate):
        return await self.__run_background("addIceCandidate", candidate)

    async def close(self):
        await self.__run_background("close", await_result=False, stop_loop=True)

    def add_rtsp_audio(self, rtsp_url):
        def add_rtsp_audio_background():
            media_player = MediaPlayer(rtsp_url, format="rtsp")
            self.pc.addTrack(media_player.audio)

        self.background_loop.call_soon_threadsafe(add_rtsp_audio_background)