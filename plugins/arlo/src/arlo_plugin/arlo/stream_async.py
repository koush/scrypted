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
import random
import threading
import time
import uuid

from .logging import logger

class Stream:
    """This class provides a queue-based EventStream object."""
    def __init__(self, arlo, expire=5):
        self.event_stream = None
        self.initializing = True
        self.connected = False
        self.reconnecting = False
        self.queues = {}
        self.expire = expire
        self.refresh = 0
        self.refresh_loop_signal = asyncio.Queue()
        self.event_stream_stop_event = threading.Event()
        self.event_stream_thread = None
        self.arlo = arlo
        self.event_loop = asyncio.get_event_loop()
        self.event_loop.create_task(self._clean_queues())
        self.event_loop.create_task(self._refresh_interval())

    def __del__(self):
        self.disconnect()

    @property
    def active(self):
        """Represents if this stream is connected or in the process of reconnecting."""
        return self.connected or self.reconnecting

    async def _refresh_interval(self):
        while not self.event_stream_stop_event.is_set():
            if self.refresh == 0:
                # to avoid spinning, wait until an interval is set
                signal = await self.refresh_loop_signal.get()
                if signal is None:
                    # exit signal received from disconnect()
                    return
                continue

            interval = self.refresh * 60  # interval in seconds from refresh in minutes
            signal_task = asyncio.create_task(self.refresh_loop_signal.get())

            # wait until either we receive a signal or the refresh interval expires
            done, pending = await asyncio.wait([signal_task, asyncio.sleep(interval)], return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()

            done_task = done.pop()
            if done_task is signal_task and done_task.result() is None:
                # exit signal received from disconnect()
                return

            logger.info("Refreshing event stream")
            await self.restart()

    def set_refresh_interval(self, interval):
        self.refresh = interval
        self.refresh_loop_signal.put_nowait(object())

    async def _clean_queues(self):
        interval = self.expire * 4

        await asyncio.sleep(interval)
        while not self.event_stream_stop_event.is_set():
            # since we interrupt the cleanup loop after every queue, there's
            # a chance the self.queues dict is modified during iteration.
            # so, we first make a copy of all the items of the dict and any
            # new queues will be processed on the next loop through
            queue_items = [i for i in self.queues.items()]
            for key, q in queue_items:
                if q.empty():
                    continue

                items = []
                num_dropped = 0

                while not q.empty():
                    item = q.get_nowait()
                    q.task_done()

                    if not item:
                        # exit signal received
                        return

                    if item.expired:
                        num_dropped += 1
                        continue

                    items.append(item)

                for item in items:
                    q.put_nowait(item)

                if num_dropped > 0:
                    logger.debug(f"Cleaned {num_dropped} events from queue {key}")

                # cleanup is not urgent, so give other tasks a chance
                await asyncio.sleep(0.1)

            await asyncio.sleep(interval)

    async def get(self, resource, action, property=None, skip_uuids={}):
        if not property:
            key = f"{resource}/{action}"
        else:
            key = f"{resource}/{action}/{property}"

        if key not in self.queues:
            q = self.queues[key] = asyncio.Queue()
        else:
            q = self.queues[key]

        first_requeued = None
        while True:
            event = await q.get()
            q.task_done()

            if not event:
                # exit signal received
                return None, action

            if first_requeued is not None and first_requeued is event:
                # if we reach here, we've cycled through the whole queue
                # and found nothing for us, so sleep and give the next
                # subscriber a chance
                q.put_nowait(event)
                await asyncio.sleep(random.uniform(0, 0.01))
                continue

            if event.expired:
                continue
            elif event.uuid in skip_uuids:
                q.put_nowait(event)
                if first_requeued is None:
                    first_requeued = event
            else:
                return event, action

    async def start(self):
        raise NotImplementedError()

    async def restart(self):
        raise NotImplementedError()

    def subscribe(self, topics):
        raise NotImplementedError()

    def _queue_response(self, response):
        resource = response.get('resource')
        action = response.get('action')
        key = f"{resource}/{action}"

        now = time.time()
        event = StreamEvent(response, now, now + self.expire)
        self._queue_impl(key, event)

        # specialized setup for error responses
        if 'error' in response:
            key = f"{resource}/error"
            self._queue_impl(key, event)

        # for optimized lookups, notify listeners of individual properties
        properties = response.get('properties', {})
        for property in properties.keys():
            key = f"{resource}/{action}/{property}"
            self._queue_impl(key, event)

    def _queue_impl(self, key, event):
        if key not in self.queues:
            q = self.queues[key] = asyncio.Queue()
        else:
            q = self.queues[key]
        q.put_nowait(event)

    def requeue(self, event, resource, action, property=None):
        if not property:
            key = f"{resource}/{action}"
        else:
            key = f"{resource}/{action}/{property}"
        self.queues[key].put_nowait(event)

    def disconnect(self):
        if self.reconnecting:
            # disconnect may be called when an old stream is being refreshed/restarted,
            # so don't completely shut down if we are reconnecting
            return

        self.connected = False

        def exit_queues(self):
            for q in self.queues.values():
                q.put_nowait(None)
            self.refresh_loop_signal.put_nowait(None)
        self.event_loop.call_soon_threadsafe(exit_queues, self)

        self.event_stream_stop_event.set()


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