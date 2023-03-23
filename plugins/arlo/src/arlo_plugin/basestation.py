from __future__ import annotations

from typing import List, TYPE_CHECKING

from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Device, DeviceProvider, ScryptedInterface, ScryptedDeviceType

from .base import ArloDeviceBase
from .vss import ArloSirenVirtualSecuritySystem

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider


class ArloBasestation(ArloDeviceBase, DeviceProvider):
    vss: ArloSirenVirtualSecuritySystem = None

    def __init__(self, nativeId: str, arlo_basestation: dict, provider: ArloProvider) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_basestation, arlo_basestation=arlo_basestation, provider=provider)

    def get_applicable_interfaces(self) -> List[str]:
        return [ScryptedInterface.DeviceProvider.value]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.DeviceProvider.value

    def get_builtin_child_device_manifests(self) -> List[Device]:
        vss_id = f'{self.arlo_device["deviceId"]}.vss'
        vss = self.get_or_create_vss(vss_id)
        return [
            {
                "info": {
                    "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                    "manufacturer": "Arlo",
                    "firmware": self.arlo_device.get("firmwareVersion"),
                    "serialNumber": self.arlo_device["deviceId"],
                },
                "nativeId": vss_id,
                "name": f'{self.arlo_device["deviceName"]} Siren Virtual Security System',
                "interfaces": vss.get_applicable_interfaces(),
                "type": vss.get_device_type(),
                "providerNativeId": self.nativeId,
            },
        ] + vss.get_builtin_child_device_manifests()

    async def getDevice(self, nativeId: str) -> ScryptedDeviceBase:
        if not nativeId.startswith(self.nativeId):
            # must be a camera, so get it from the provider
            return await self.provider.getDevice(nativeId)
        return self.get_or_create_vss(nativeId)

    def get_or_create_vss(self, nativeId: str) -> ArloSirenVirtualSecuritySystem:
        if not nativeId.endswith("vss"):
            return None
        if not self.vss:
            self.vss = ArloSirenVirtualSecuritySystem(nativeId, self.arlo_device, self.arlo_basestation, self.provider)
        return self.vss