from scrypted_sdk.types import BinarySensor, ScryptedInterface

from .camera import ArloCamera


class ArloDoorbell(ArloCamera, BinarySensor):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self.logger_name = f"{self.nativeId}.doorbell"

        self.start_doorbell_subscription()

    def start_doorbell_subscription(self):
        def callback(doorbellPressed):
            self.binaryState = doorbellPressed
            return self.stop_subscriptions
 
        self.register_task(
            self.provider.arlo.SubscribeToDoorbellEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def get_applicable_interfaces(self):
        camera_interfaces = super().get_applicable_interfaces()
        camera_interfaces.append(ScryptedInterface.BinarySensor.value)

        model_id = self.arlo_device['properties']['modelId'].lower()
        if model_id.startswith("avd1001"):
            camera_interfaces.remove(ScryptedInterface.Battery.value)
        return camera_interfaces
        