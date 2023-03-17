from scrypted_sdk.types import BinarySensor, ScryptedInterface

from .camera import ArloCamera
from .provider import ArloProvider


class ArloDoorbell(ArloCamera, BinarySensor):
    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)

        self.start_doorbell_subscription()

    def start_doorbell_subscription(self) -> None:
        def callback(doorbellPressed):
            self.binaryState = doorbellPressed
            return self.stop_subscriptions

        self.register_task(
            self.provider.arlo.SubscribeToDoorbellEvents(self.arlo_basestation, self.arlo_device, callback)
        )

    def get_applicable_interfaces(self) -> list:
        camera_interfaces = super().get_applicable_interfaces()
        camera_interfaces.append(ScryptedInterface.BinarySensor.value)

        model_id = self.arlo_device['modelId'].lower()
        if model_id.startswith("avd1001"):
            camera_interfaces.remove(ScryptedInterface.Battery.value)
        return camera_interfaces
