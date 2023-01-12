from aiortc import RTCPeerConnection
from aiortc.contrib.media import MediaPlayer
import asyncio
import threading
import logging
import os
import queue
import sys
import tempfile
from urllib.parse import urlparse


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

        self.pending_tasks = set()
        self.stopped = False
        self.cleanup_background = None

    def __background_main(self):
        logger.debug(f"Background RTC loop {self.thread.name} starting")
        self.pc = RTCPeerConnection()

        asyncio.set_event_loop(self.background_loop)
        self.thread_started.put(True)
        self.background_loop.run_forever()

        if self.cleanup_background is not None:
            self.cleanup_background()

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

            task = self.background_loop.create_task(coroutine)
            self.pending_tasks.add(task)
            task.add_done_callback(callback)
            task.add_done_callback(self.pending_tasks.discard)
            task.add_done_callback(
                lambda _:
                self.background_loop.stop() if self.stopped and len(self.pending_tasks)
                else None
            )

        # start the callback in the background loop
        self.background_loop.call_soon_threadsafe(background_callback)

        if not await_result:
            return None
        return await fut

    async def createOffer(self):
        return await self.__run_background(self.pc.createOffer())

    async def setLocalDescription(self, sdp):
        return await self.__run_background(self.pc.setLocalDescription(sdp))

    async def setRemoteDescription(self, sdp):
        return await self.__run_background(self.pc.setRemoteDescription(sdp))

    async def addIceCandidate(self, candidate):
        return await self.__run_background(self.pc.addIceCandidate(candidate))

    async def close(self):
        if self.stopped:
            return
        self.stopped = True
        await self.__run_background(self.pc.close(), await_result=False, stop_loop=True)

    async def add_audio(self, options):
        """Adds an audio track to the RTCPeerConnection given FFmpeg options.

        This constructs a MediaPlayer in the background thread's asyncio loop,
        since MediaPlayer also utilizes coroutines and asyncio.

        Note that this may block the background thread's event loop if the
        server is not yet ready.
        """
        try:
            input = options["i"]
            format = options.get("f")
            if format is None and input.startswith("rtsp"):
                format = "rtsp"
        except:
            logger.error("error detecting what input file and format to use")
            raise

        logger.info(f"Intercom sourced from {input} with format {format}")

        if format == "sdp" and input.startswith("tcp"):
            input = await self.__sdp_to_file(input)

        def add_audio_background():
            media_player = MediaPlayer(input, format=format, options=options)

            # patch the player's stop function to close RTC if
            # the media ends before RTC is closed
            old_stop = media_player._stop
            def new_stop(*args, **kwargs):
                old_stop(*args, **kwargs)
                self.main_loop.call_soon_threadsafe(self.main_loop.create_task, self.close())
            media_player._stop = new_stop

            self.pc.addTrack(media_player.audio)

        self.background_loop.call_soon_threadsafe(add_audio_background)

    async def __sdp_to_file(self, endpoint):
        url = urlparse(endpoint)
        logger.debug(f"Reading sdp file from {url.hostname}:{url.port}")
        reader, writer = await asyncio.open_connection(url.hostname, url.port)

        sdp_contents = bytes()
        while True:
            line = await reader.readline()
            if not line:
                break
            sdp_contents += line

        logger.debug("Finished reading sdp")

        writer.close()
        await writer.wait_closed()

        logger.info(f"Received intercom input sdp:\n{sdp_contents.decode('utf-8')}")

        fd, filename = tempfile.mkstemp(".sdp")
        os.write(fd, sdp_contents)
        os.close(fd)

        logger.info(f"Wrote sdp to file {filename}")

        def cleanup_background():
            os.remove(filename)
            logger.info(f"Deleted sdp file {filename}")
        self.cleanup_background = cleanup_background

        return filename