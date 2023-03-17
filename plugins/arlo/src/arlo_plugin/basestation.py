from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import DeviceProvider, ScryptedInterface

from .device_base import ArloDeviceBase


class ArloBasestation(ArloDeviceBase, DeviceProvider):

    def get_applicable_interfaces(self) -> list:
        return [ScryptedInterface.DeviceProvider.value]

    async def getDevice(self, nativeId: str) -> ScryptedDeviceBase:
        return await self.provider.getDevice(nativeId)
