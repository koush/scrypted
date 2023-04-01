from __future__ import annotations

from typing import List, TYPE_CHECKING

from scrypted_sdk.types import BinarySensor, ScryptedInterface, ScryptedDeviceType

from .camera import ArloCamera

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
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

    def get_device_type(self) -> str:
        return ScryptedDeviceType.Doorbell.value

    def get_applicable_interfaces(self) -> List[str]:
        camera_interfaces = super().get_applicable_interfaces()
        camera_interfaces.append(ScryptedInterface.BinarySensor.value)
        return camera_interfaces
