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
import sseclient
import threading
import time
import uuid

# TODO: There's a lot more refactoring that could/should be done to abstract out the arlo-specific implementation details.

class EventStream:
    """This class provides a queue-based EventStream object."""
    def __init__(self, arlo, expire=30):
        self.event_stream = None
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
        while not self.event_stream_stop_event.is_set():
            print("Running periodic queue cleanup")

            for key, q in self.queues.items():
                items = []
                num_dropped = 0
                while not q.empty():
                    item = q.get_nowait()
                    q.task_done()

                    if time.time() - item.timestamp > self.expire:
                        num_dropped += 1
                        continue

                    items.append(item)

                for item in items:
                    q.put_nowait(item)

                print(f"Cleaned {num_dropped} events from queue {key}")

            await asyncio.sleep(self.expire * 2)

    async def get(self, resource, actions, timeout=None):
        async def get_impl(resource, actions):
            while True:
                for action in actions:
                    key = f"{resource}/{action}"
                    if key not in self.queues:
                        await asyncio.sleep(0)
                        continue

                    q = self.queues[key]
                    if q.empty():
                        await asyncio.sleep(0)
                        continue

                    event = q.get_nowait()
                    q.task_done()
                    if time.time() - event.timestamp > self.expire:
                        # dropping expired events
                        await asyncio.sleep(0)
                        break

                    return event, action
        return await asyncio.wait_for(get_impl(resource, actions), timeout)

    async def start(self):
        if self.event_stream is not None:
            return

        def thread_main(self):
            for event in self.event_stream:
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
                        self.event_loop.call_soon_threadsafe(
                            lambda: asyncio.create_task(
                                self._queue_response(response)
                            )
                        )
                elif response.get('status') == 'connected':
                    self.connected = True

        self.event_stream = sseclient.SSEClient('https://myapi.arlo.com/hmsweb/client/subscribe?token='+self.arlo.request.session.headers.get('Authorization').decode(), session=self.arlo.request.session)
        self.event_stream_thread = threading.Thread(name="EventStream", target=thread_main, args=(self, ))
        self.event_stream_thread.setDaemon(True)
        self.event_stream_thread.start()

        while not self.connected and not self.event_stream_stop_event.is_set():
            await asyncio.sleep(0.5)

        asyncio.get_event_loop().create_task(self._clean_queues())

    async def _queue_response(self, response):
        resource = response.get('resource')
        action = response.get('action')
        q = self.queues.setdefault(f"{resource}/{action}", asyncio.Queue())
        await q.put(StreamEvent(response, time.time()))

    async def requeue(self, event, resource, action):
        key = f"{resource}/{action}"
        await self.queues[key].put(event)

    def disconnect(self):
        self.connected = False

        for _, q in self.queues:
            self.event_loop.call_soon_threadsafe(
                lambda: asyncio.create_task(
                    q.put(None)
                )
            )

        self.event_stream_stop_event.set()

        if self.event_stream_thread != threading.current_thread():
            self.event_stream_thread.join()

class StreamEvent:
    item = None
    timestamp = None
    uuid = None

    def __init__(self, item, timestamp):
        self.item = item
        self.timestamp = timestamp
        self.uuid = str(uuid.uuid4())