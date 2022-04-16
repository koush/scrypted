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
import paho.mqtt.client as mqtt
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

            await asyncio.sleep(interval)

    def _gen_client_number(self):
        return random.randint(1000000000, 9999999999)

    async def get(self, resource, actions, skip_uuids={}):
        if len(actions) == 1:
            action = actions[0]
            key = f"{resource}/{action}"

            while key not in self.queues:
                await asyncio.sleep(0.5)
            q = self.queues[key]

            while True:
                event = await q.get()
                q.task_done()

                if event.expired:
                    continue
                elif event.uuid in skip_uuids:
                    q.put_nowait(event)
                    await asyncio.sleep(random.uniform(0, 0.01))
                else:
                    return event, action
        else:
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
                            q.put_nowait(event)
                            break

                        if event.expired:
                            continue
                        elif event.uuid in skip_uuids:
                            q.put_nowait(event)

                            if first_requeued is None:
                                first_requeued = event
                        else:
                            return event, action
                await asyncio.sleep(random.uniform(0, 0.01))

    async def start(self):
        if self.event_stream is not None:
            return

        def on_connect(client, userdata, flags, rc):
            self.connected = True
            self.initializing = False

            client.subscribe([
                (f"u/{self.arlo.user_id}/in/userSession/connect", 0),
                (f"u/{self.arlo.user_id}/in/userSession/disconnect", 0),
            ])

        def on_message(client, userdata, msg):
            payload = msg.payload.decode()
            logger.debug(f"Received event: {payload}")

            try:
                response = json.loads(payload.strip())
            except json.JSONDecodeError:
                return

            if response.get('resource') is not None:
                self.event_loop.call_soon_threadsafe(self._queue_response, response)

        self.event_stream = mqtt.Client(client_id=f"user_{self.arlo.user_id}_{self._gen_client_number()}", transport="websockets", clean_session=False)
        self.event_stream.username_pw_set(self.arlo.user_id, password=self.arlo.request.session.headers.get('Authorization'))
        self.event_stream.ws_set_options(path="/mqtt", headers={"Origin": "https://my.arlo.com"})
        self.event_stream.enable_logger(logger=logger)
        self.event_stream.on_connect = on_connect
        self.event_stream.on_message = on_message
        self.event_stream.tls_set()
        self.event_stream.connect_async("mqtt-cluster.arloxcld.com", port=443)
        self.event_stream.loop_start()

        while not self.connected:
            await asyncio.sleep(0.5)

        asyncio.get_event_loop().create_task(self._clean_queues())

    def subscribe(self, topics):
        if topics:
            self.event_stream.subscribe([(topic, 0) for topic in topics])

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
            for q in self.queues.values():
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