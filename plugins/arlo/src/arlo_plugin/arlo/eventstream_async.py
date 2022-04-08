# This file has been modified to support async semantics and better
# integration with scrypted.
# Original: https://github.com/jeffreydwalter/arlo

##
# Copyright 2016 Jeffrey D. Walter
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
##

import asyncio
import json
import random
import sseclient
import threading
import time
import uuid

from .logging import logger

# TODO: There's a lot more refactoring that could/should be done to abstract out the arlo-specific implementation details.

class EventStream:
    """This class provides a queue-based EventStream object."""
    def __init__(self, arlo, expire=15):
        self.event_stream = None
        self.initializing = True
        self.connected = False
        self.registered = False
        self.queues = {}
        self.expire = expire
        self.event_stream_stop_event = threading.Event()
        self.arlo = arlo
        self.event_loop = asyncio.get_event_loop()
 
    def __del__(self):
        self.disconnect()

    async def _clean_queues(self):
        interval = self.expire * 2

        await asyncio.sleep(interval)
        while not self.event_stream_stop_event.is_set():
            empty_queues = []

            for key, q in self.queues.items():
                items = []
                num_dropped = 0

                while not q.empty():
                    item = q.get_nowait()
                    q.task_done()

                    if item.expired:
                        num_dropped += 1
                        continue

                    items.append(item)

                for item in items:
                    q.put_nowait(item)

                if num_dropped > 0:
                    logger.debug(f"Cleaned {num_dropped} events from queue {key}")

                if q.empty():
                    empty_queues.append(key)

            for key in empty_queues:
                del self.queues[key]
                logger.debug(f"Removed empty queue {key}")

            await asyncio.sleep(interval)

    async def get(self, resource, actions, skip_uuids={}):
        while True:
            for action in actions:
                key = f"{resource}/{action}"
                if key not in self.queues:
                    continue

                q = self.queues[key]
                if q.empty():
                    continue

                first_requeued = None
                while not q.empty():
                    event = q.get_nowait()
                    q.task_done()

                    if first_requeued is not None and first_requeued is event:
                        # if we reach here, we've cycled through the whole queue
                        # and found nothing for us, so go to the next queue
                        break

                    if event.expired:
                        continue
                    elif event.uuid in skip_uuids:
                        q.put_nowait(event)

                        if first_requeued is None:
                            first_requeued = event
                    else:
                        return event, action
            await asyncio.sleep(random.uniform(0, 0.1))

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
                    elif response.get('resource') is not None:
                        self.event_loop.call_soon_threadsafe(self._queue_response, response)
                elif response.get('status') == 'connected':
                    self.initializing = False
                    self.connected = True

        self.event_stream = sseclient.SSEClient('https://myapi.arlo.com/hmsweb/client/subscribe?token='+self.arlo.request.session.headers.get('Authorization').decode(), session=self.arlo.request.session)
        self.event_stream_thread = threading.Thread(name="EventStream", target=thread_main, args=(self, ))
        self.event_stream_thread.setDaemon(True)
        self.event_stream_thread.start()

        while not self.connected and not self.event_stream_stop_event.is_set():
            await asyncio.sleep(0.5)

        asyncio.get_event_loop().create_task(self._clean_queues())

    def _queue_response(self, response):
        resource = response.get('resource')
        action = response.get('action')
        key = f"{resource}/{action}"
        if key not in self.queues:
            q = self.queues[key] = asyncio.Queue()
        else:
            q = self.queues[key]
        now = time.time()
        q.put_nowait(StreamEvent(response, now, now + self.expire))

    def requeue(self, event, resource, action):
        key = f"{resource}/{action}"
        self.queues[key].put_nowait(event)

    def disconnect(self):
        self.connected = False

        def exit_queues(self):
            for _, q in self.queues:
                q.put_nowait(None)
        self.event_loop.call_soon_threadsafe(exit_queues, self)

        self.event_stream_stop_event.set()

        if self.event_stream_thread != threading.current_thread():
            self.event_stream_thread.join()

class StreamEvent:
    item = None
    timestamp = None
    expiration = None
    uuid = None

    def __init__(self, item, timestamp, expiration):
        self.item = item
        self.timestamp = timestamp
        self.expiration = expiration
        self.uuid = str(uuid.uuid4())

    @property
    def expired(self):
        return time.time() > self.expiration