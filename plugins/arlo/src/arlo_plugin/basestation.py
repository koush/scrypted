from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import DeviceProvider, ScryptedInterface, ScryptedDeviceType

from .device_base import ArloDeviceBase
from .siren import ArloSiren


class ArloBasestation(ArloDeviceBase, DeviceProvider):
    siren: ArloSiren = None

    def get_applicable_interfaces(self) -> list:
        return [ScryptedInterface.DeviceProvider.value]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.DeviceProvider.value

    def get_builtin_child_device_manifests(self) -> list:
        return [
            {
                "info": {
                    "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                    "manufacturer": "Arlo",
                    "firmware": self.arlo_device.get("firmwareVersion"),
                    "serialNumber": self.arlo_device["deviceId"],
                },
                "nativeId": f'{self.arlo_device["deviceId"]}.siren',
                "name": f'{self.arlo_device["deviceName"]} Siren',
                "interfaces": [ScryptedInterface.OnOff.value],
                "type": ScryptedDeviceType.Siren.value,
                "providerNativeId": self.nativeId,
            }
        ]

    async def getDevice(self, nativeId: str) -> ScryptedDeviceBase:
        if not nativeId.startswith(self.nativeId):
            # must be a camera, so get it from the provider
            return await self.provider.getDevice(nativeId)

        if nativeId.endswith("siren"):
            if not self.siren:
                self.siren = ArloSiren(nativeId, self.arlo_device, self.arlo_basestation, self.provider)
            return self.siren

        return None