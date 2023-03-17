from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import DeviceProvider, ScryptedInterface, ScryptedDeviceType

from .device_base import ArloDeviceBase
from .siren import ArloSiren


class ArloBasestation(ArloDeviceBase, DeviceProvider):

    def get_applicable_interfaces(self) -> list:
        return [ScryptedInterface.DeviceProvider.value]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.DeviceProvider.value

    async def getDevice(self, nativeId: str) -> ScryptedDeviceBase:
        if not nativeId.startswith(self.nativeId):
            # must be a camera, so get it from the provider
            return await self.provider.getDevice(nativeId)

        if nativeId.endswith("siren"):
            return ArloSiren(nativeId, self.arlo_device, self.arlo_basestation, self.provider)

        return None