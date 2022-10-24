from scrypted_sdk.types import BinarySensor

from .camera import ArloCamera

class ArloDoorbell(ArloCamera, BinarySensor):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self.start_doorbell_subscription()

    def start_doorbell_subscription(self):
        def callback(doorbellPressed):
            self.binaryState = doorbellPressed
            return self.stop_subscriptions
 
        self.provider.arlo.SubscribeToDoorbellEvents(self.arlo_basestation, self.arlo_device, callback)