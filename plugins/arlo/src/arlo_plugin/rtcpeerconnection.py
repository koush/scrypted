from aiortc import RTCPeerConnection
from aiortc.mediastreams import AudioStreamTrack as SilenceStreamTrack
from aiortc.contrib.media import MediaPlayer, MediaRelay
import asyncio
import threading
import queue


class BackgroundThreadedLoop:
    """Class that manages a background thread and its asyncio loop."""

    def __init__(self, logger):
        self.logger = logger
        self.main_loop = asyncio.get_event_loop()
        self.background_loop = asyncio.new_event_loop()

        self.thread_started = queue.Queue(1)
        self.thread = threading.Thread(target=self.__background_main)
        self.thread.start()
        self.thread_started.get()

        self.pending_tasks = set()
        self.handles = 1

    def __background_main(self):
        self.logger.debug(f"Background RTC loop {self.thread.name} starting")

        asyncio.set_event_loop(self.background_loop)
        self.thread_started.put(True)
        self.background_loop.run_forever()

        self.logger.debug(f"Background RTC loop {self.thread.name} exiting")

    async def run_background(self, coroutine, await_result=True):
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
                self.background_loop.stop() if self.handles == 0 and len(self.pending_tasks) == 0
                else None
            )

        # start the callback in the background loop
        self.background_loop.call_soon_threadsafe(background_callback)

        if not await_result:
            return None
        return await fut

    async def close_with(self, coroutine, await_result=False):
        if self.handles == 0:
            return
        self.handles -= 1
        await self.run_background(coroutine, await_result=await_result)


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

    def __init__(self, logger, background=None):
        self.background = background
        if background:
            self.background.handles += 1
        else:
            self.background = BackgroundThreadedLoop(logger)
        self.logger = logger

        self.pc = None
        self.track_queue = asyncio.Queue()
        self.stopped = False

        self.muted_relays = {}

        self.initialized = queue.Queue(1)
        self.background.background_loop.call_soon_threadsafe(self.__background_init)
        self.initialized.get()

    def __background_init(self):
        pc = self.pc = RTCPeerConnection()

        @pc.on("track")
        def on_track(track):
            self.background.main_loop.call_soon_threadsafe(
                self.background.main_loop.create_task,
                self.track_queue.put(track),
            )

        self.initialized.put(True)
    
    async def __run_background(self, coroutine, await_result=True):
        return await self.background.run_background(coroutine, await_result=await_result)

    async def createOffer(self):
        return await self.__run_background(self.pc.createOffer())

    async def createAnswer(self):
        return await self.__run_background(self.pc.createAnswer())

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
        await self.track_queue.put(None)
        await self.background.close_with(self.pc.close())

    async def add_media(self, endpoint, format=None, options={}):
        """Adds media track(s) to the RTCPeerConnection, using provided arguments.

        This constructs a MediaPlayer in the background thread's asyncio loop,
        since MediaPlayer also utilizes coroutines and asyncio.

        Note that this may block the background thread's event loop if the
        endpoint server is not yet ready.
        """
        main_loop = self.background.main_loop
        background_loop = self.background.background_loop

        def add_media_background():
            self.logger.debug(f"Adding endpoint {endpoint} to MediaPlayer")
            media_player = MediaPlayer(endpoint, format=format, options=options)
            media_player._throttle_playback = False
            self.logger.debug(f"Added endpoint {endpoint} to MediaPlayer")

            # patch the player's stop function to close RTC if
            # the media ends before RTC is closed
            old_stop = media_player._stop
            def new_stop(*args, **kwargs):
                old_stop(*args, **kwargs)
                main_loop.call_soon_threadsafe(main_loop.create_task, self.close())
            media_player._stop = new_stop

            if media_player.audio is not None:
                self.pc.addTrack(media_player.audio)
            if media_player.video is not None:
                self.pc.addTrack(media_player.video)

        background_loop.call_soon_threadsafe(add_media_background)

    async def subscribe_track(self, track):
        relay_fut = self.background.main_loop.create_future()

        def relay_background():
            self.logger.debug("Starting track relay")
            relay = MediaRelay()
            relay_track = relay.subscribe(track, buffered=False)
            self.pc.addTrack(relay_track)
            self.background.main_loop.call_soon_threadsafe(relay_fut.set_result, relay_track)
            self.logger.debug("Started track relay")

        self.background.background_loop.call_soon_threadsafe(relay_background)
        return await relay_fut

    async def mute_relay(self, relay_track):
        def mute_background():
            self.logger.debug("Muting track relay")
            if relay_track in self.muted_relays:
                self.logger.debug("Track already muted!")
                return

            silence = SilenceStreamTrack()
            self.muted_relays[relay_track] = relay_track.recv
            relay_track.recv = silence.recv
            self.logger.debug("Muted track relay")

        self.background.background_loop.call_soon_threadsafe(mute_background)

    async def unmute_relay(self, relay_track):
        def unmute_background():
            self.logger.debug("Unmuting track relay")
            if relay_track not in self.muted_relays:
                self.logger.debug("Track already unmuted!")
                return
            relay_track.recv = self.muted_relays[relay_track]
            del self.muted_relays[relay_track]
            self.logger.debug("Unmuted track relay")
        self.background.background_loop.call_soon_threadsafe(unmute_background)

    def on_track(self, callback):
        async def loop():
            while not self.stopped:
                try:
                    track = await asyncio.wait_for(self.track_queue.get(), 5)
                except asyncio.TimeoutError:
                    continue
                if not track:
                    break
                await callback(track)
        self.background.main_loop.create_task(loop())
