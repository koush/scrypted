import asyncio
import json
import random
import paho.mqtt.client as mqtt

from .stream_async import Stream 
from .logging import logger

class MQTTStream(Stream):

    def _gen_client_number(self):
        return random.randint(1000000000, 9999999999)

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
        #self.event_stream.enable_logger(logger=logger)
        self.event_stream.on_connect = on_connect
        self.event_stream.on_message = on_message
        self.event_stream.tls_set()
        self.event_stream.connect_async("mqtt-cluster.arloxcld.com", port=443)
        self.event_stream.loop_start()

        while not self.connected and not self.event_stream_stop_event.is_set():
            await asyncio.sleep(0.5)

        asyncio.get_event_loop().create_task(self._clean_queues())

    def subscribe(self, topics):
        if topics:
            self.event_stream.subscribe([(topic, 0) for topic in topics])
