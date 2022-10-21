import asyncio
import json
import sseclient
import threading

from .stream_async import Stream 
from .logging import logger


class SSEClient(sseclient.SSEClient):
    """Inherits SSEClient with more exceptions captured in the iterator."""

    # This effectively patches the parent iterator of sseclient 0.0.22,
    # where the only difference is the exception list adds
    # http.client.IncompleteRead
    def __next__(self):
        from sseclient import (
            codecs,
            re,
            time,
            six,
            requests,
            end_of_field,
            Event
        )
        from http.client import IncompleteRead as httplib_IncompleteRead

        decoder = codecs.getincrementaldecoder(
            self.resp.encoding)(errors='replace')
        while not self._event_complete():
            try:
                next_chunk = next(self.resp_iterator)
                if not next_chunk:
                    raise EOFError()
                self.buf += decoder.decode(next_chunk)

            except (StopIteration, requests.RequestException, EOFError, six.moves.http_client.IncompleteRead, httplib_IncompleteRead) as e:
                print(e)
                time.sleep(self.retry / 1000.0)
                self._connect()

                # The SSE spec only supports resuming from a whole message, so
                # if we have half a message we should throw it out.
                head, sep, tail = self.buf.rpartition('\n')
                self.buf = head + sep
                continue

        # Split the complete event (up to the end_of_field) into event_string,
        # and retain anything after the current complete event in self.buf
        # for next time.
        (event_string, self.buf) = re.split(end_of_field, self.buf, maxsplit=1)
        msg = Event.parse(event_string)

        # If the server requests a specific retry delay, we need to honor it.
        if msg.retry:
            self.retry = msg.retry

        # last_id should only be set if included in the message.  It's not
        # forgotten if a message omits it.
        if msg.id:
            self.last_id = msg.id

        return msg


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