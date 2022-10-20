import asyncio
import json
import sseclient
import threading

from .stream_async import Stream 
from .logging import logger


class SSEClient(sseclient.SSEClient):
    """Inherits SSEClient with debugging instrumentation."""

    def __next__(self):
        try:
            return super().__next__()
        except Exception as e:
            logger.error(f"SSEClient iterator failed with {type(e)}: {str(e)}")
            return sseclient.Event()


class EventStream(Stream):

    async def start(self):
        if self.event_stream is not None:
            return

        def thread_main(self):
            for event in self.event_stream:
                logger.debug(f"Received event: {event}")
                if event is None or self.event_stream_stop_event.is_set():
                    return None

                if event.data.strip() == "":
                    continue

                try:
                    response = json.loads(event.data)
                except json.JSONDecodeError:
                    continue

                if self.connected:
                    if response.get('action') == 'logout':
                        self.disconnect()
                        return None
                    else:
                        self.event_loop.call_soon_threadsafe(self._queue_response, response)
                elif response.get('status') == 'connected':
                    self.initializing = False
                    self.connected = True

        self.event_stream = SSEClient('https://myapi.arlo.com/hmsweb/client/subscribe?token='+self.arlo.request.session.headers.get('Authorization'), session=self.arlo.request.session)
        self.event_stream_thread = threading.Thread(name="EventStream", target=thread_main, args=(self, ))
        self.event_stream_thread.setDaemon(True)
        self.event_stream_thread.start()

        while not self.connected and not self.event_stream_stop_event.is_set():
            await asyncio.sleep(0.5)

        asyncio.get_event_loop().create_task(self._clean_queues())

    def subscribe(self, topics):
        pass