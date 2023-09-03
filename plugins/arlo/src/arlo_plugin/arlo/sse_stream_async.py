import asyncio
import json
import threading

import scrypted_arlo_go

from .stream_async import Stream
from .logging import logger


class EventStream(Stream):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.shutting_down_stream = None  # record the eventstream that is currently shutting down

    async def start(self):
        if self.event_stream is not None:
            return

        def thread_main(self):
            event_stream = self.event_stream
            while True:
                try:
                    event = event_stream.Next()
                except:
                    logger.info(f"SSE {event_stream.UUID} exited")
                    if self.shutting_down_stream is event_stream:
                        self.shutting_down_stream = None
                    return None

                logger.debug(f"Received event: {event}")

                if event.strip() == "":
                    continue

                try:
                    response = json.loads(event.strip())
                except json.JSONDecodeError:
                    continue

                if response.get('action') == 'logout':
                    if self.event_stream_stop_event.is_set() or \
                        self.shutting_down_stream is event_stream:
                        logger.info(f"SSE {event_stream.UUID} disconnected")
                        self.shutting_down_stream = None
                        event_stream.Close()
                        return None
                elif response.get('status') == 'connected':
                    if not self.connected:
                        logger.info(f"SSE {event_stream.UUID} connected")
                        self.initializing = False
                        self.connected = True
                else:
                    self.event_loop.call_soon_threadsafe(self._queue_response, response)

        self.event_stream = scrypted_arlo_go.NewSSEClient(
            'https://myapi.arlo.com/hmsweb/client/subscribe?token='+self.arlo.request.session.headers.get('Authorization'),
            scrypted_arlo_go.HeadersMap(self.arlo.request.session.headers)
        )
        self.event_stream.Start()
        self.event_stream_thread = threading.Thread(name="EventStream", target=thread_main, args=(self, ))
        self.event_stream_thread.setDaemon(True)
        self.event_stream_thread.start()

        while not self.connected and not self.event_stream_stop_event.is_set():
            await asyncio.sleep(0.5)

    async def restart(self):
        self.reconnecting = True
        self.connected = False
        self.shutting_down_stream = self.event_stream
        self.shutting_down_stream.Close()
        self.event_stream = None
        await self.start()
        while self.shutting_down_stream is not None:
            # ensure any previous connections have disconnected properly
            # this is so we can mark reconnecting to False properly
            await asyncio.sleep(1)
        self.reconnecting = False

    def subscribe(self, topics):
        pass