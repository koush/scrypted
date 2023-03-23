from __future__ import annotations

import asyncio
from typing import List, TYPE_CHECKING

from scrypted_sdk.types import Device, DeviceProvider, SecuritySystem, SecuritySystemMode, ScryptedInterface, ScryptedDeviceType

from .base import ArloDeviceBase
from .siren import ArloSiren

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider


class ArloSirenVirtualSecuritySystem(ArloDeviceBase, SecuritySystem, DeviceProvider):
    """A virtual, emulated security system that controls when scrypted events can trip the real physical siren."""

    SUPPORTED_MODES = [SecuritySystemMode.AwayArmed.value, SecuritySystemMode.HomeArmed.value, SecuritySystemMode.Disarmed.value]

    siren: ArloSiren = None

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)
        self.create_task(self.delayed_init())

    @property
    def mode(self) -> str:
        mode = self.storage.getItem("mode")
        if mode is None or mode not in ArloSirenVirtualSecuritySystem.SUPPORTED_MODES:
            mode = SecuritySystemMode.Disarmed.value
        return mode

    @mode.setter
    def mode(self, mode: str) -> None:
        if mode not in ArloSirenVirtualSecuritySystem.SUPPORTED_MODES:
            raise ValueError(f"invalid mode {mode}")
        self.storage.setItem("mode", mode)

    async def delayed_init(self) -> None:
        iterations = 1
        while not self.stop_subscriptions:
            if iterations > 100:
                self.logger.error("Delayed init exceeded iteration limit, giving up")
                return

            try:
                self.securitySystemState = {
                    "supportedModes": ArloSirenVirtualSecuritySystem.SUPPORTED_MODES,
                    "mode": self.mode,
                }
                return
            except Exception as e:
                self.logger.info(f"Delayed init failed, will try again: {e}")
                await asyncio.sleep(0.1)
            iterations += 1

    def get_applicable_interfaces(self) -> List[str]:
        return [
            ScryptedInterface.SecuritySystem.value,
            ScryptedInterface.DeviceProvider.value,
        ]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.SecuritySystem.value

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

    async def getDevice(self, nativeId: str) -> ArloDeviceBase:
        return self.get_or_create_siren(nativeId)

    def get_or_create_siren(self, nativeId: str) -> ArloSiren:
        if not nativeId.endswith("siren"):
            return None
        if not self.siren:
            self.siren = ArloSiren(nativeId, self.arlo_device, self.arlo_basestation, self.provider, self)
        return self.siren

    async def armSecuritySystem(self, mode: SecuritySystemMode) -> None:
        self.logger.info(f"Arming {mode}")
        self.mode = mode
        self.securitySystemState = {
            **self.securitySystemState,
            "mode": mode,
        }

    async def disarmSecuritySystem(self) -> None:
        self.logger.info(f"Disarming")
        self.mode = SecuritySystemMode.Disarmed.value
        self.securitySystemState = {
            **self.securitySystemState,
            "mode": SecuritySystemMode.Disarmed.value,
        }
