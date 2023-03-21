from typing import List

from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Device, DeviceProvider, ScryptedInterface, ScryptedDeviceType

from .device_base import ArloDeviceBase
from .siren import ArloSiren


class ArloBasestation(ArloDeviceBase, DeviceProvider):
    siren: ArloSiren = None

    def get_applicable_interfaces(self) -> List[str]:
        return [ScryptedInterface.DeviceProvider.value]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.DeviceProvider.value

    def get_builtin_child_device_manifests(self) -> List[Device]:
        siren_id = f'{self.arlo_device["deviceId"]}.siren'
        siren = self.get_or_create_siren(siren_id)
        return [
            {
                "info": {
                    "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                    "manufacturer": "Arlo",
                    "firmware": self.arlo_device.get("firmwareVersion"),
                    "serialNumber": self.arlo_device["deviceId"],
                },
                "nativeId": siren_id,
                "name": f'{self.arlo_device["deviceName"]} Siren',
                "interfaces": siren.get_applicable_interfaces(),
                "type": siren.get_device_type(),
                "providerNativeId": self.nativeId,
            }
        ]

    async def getDevice(self, nativeId: str) -> ScryptedDeviceBase:
        if not nativeId.startswith(self.nativeId):
            # must be a camera, so get it from the provider
            return await self.provider.getDevice(nativeId)
        return self.get_or_create_siren(nativeId)

    def get_or_create_siren(self, nativeId: str) -> ArloSiren:
        if not nativeId.endswith("siren"):
            return None

        if not self.siren:
            self.siren = ArloSiren(nativeId, self.arlo_device, self.arlo_basestation, self.provider)
        return self.siren