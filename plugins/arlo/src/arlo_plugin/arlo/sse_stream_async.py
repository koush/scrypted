import asyncio
import json
import sseclient
import threading

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
            for event in event_stream:
                logger.debug(f"Received event: {event}")
                if event is None:
                    logger.info(f"SSE {id(event_stream)} appears to be broken")
                    return None

                if event.data.strip() == "":
                    continue

                try:
                    response = json.loads(event.data.strip())
                except json.JSONDecodeError:
                    continue

                if response.get('action') == 'logout':
                    if self.event_stream_stop_event.is_set() or \
                        self.shutting_down_stream is event_stream:
                        logger.info(f"SSE {id(event_stream)} disconnected")
                        self.shutting_down_stream = None
                        return None
                elif response.get('status') == 'connected':
                    if not self.connected:
                        logger.info(f"SSE {id(event_stream)} connected")
                        self.initializing = False
                        self.connected = True
                else:
                    self.event_loop.call_soon_threadsafe(self._queue_response, response)

        self.event_stream = sseclient.SSEClient('https://myapi.arlo.com/hmsweb/client/subscribe?token='+self.arlo.request.session.headers.get('Authorization'), session=self.arlo.request.session)
        self.event_stream_thread = threading.Thread(name="EventStream", target=thread_main, args=(self, ))
        self.event_stream_thread.setDaemon(True)
        self.event_stream_thread.start()

        while not self.connected and not self.event_stream_stop_event.is_set():
            await asyncio.sleep(0.5)

    async def restart(self):
        self.reconnecting = True
        self.connected = False
        self.shutting_down_stream = self.event_stream
        self.event_stream = None
        await self.start()
        while self.shutting_down_stream is not None:
            # ensure any previous connections have disconnected properly
            # this is so we can mark reconnecting to False properly
            await asyncio.sleep(1)
        self.reconnecting = False

    def subscribe(self, topics):
        pass