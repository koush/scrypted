from __future__ import annotations

import asyncio
from typing import List, TYPE_CHECKING

from scrypted_sdk.types import Device, DeviceProvider, Setting, Settings, SettingValue, SecuritySystem, SecuritySystemMode, Readme, ScryptedInterface, ScryptedDeviceType

from .base import ArloDeviceBase
from .siren import ArloSiren
from .util import async_print_exception_guard

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider
    from .basestation import ArloBasestation
    from .camera import ArloCamera


class ArloSirenVirtualSecuritySystem(ArloDeviceBase, SecuritySystem, Settings, Readme, DeviceProvider):
    """A virtual, emulated security system that controls when scrypted events can trip the real physical siren."""

    SUPPORTED_MODES = [SecuritySystemMode.AwayArmed.value, SecuritySystemMode.HomeArmed.value, SecuritySystemMode.Disarmed.value]

    siren: ArloSiren = None
    parent: ArloBasestation | ArloCamera = None

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider, parent: ArloBasestation | ArloCamera) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)
        self.parent = parent
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
        self.securitySystemState = {
            **self.securitySystemState,
            "mode": mode,
        }
        self.create_task(self.onDeviceEvent(ScryptedInterface.Settings.value, None))

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
                self.logger.debug(f"Delayed init failed, will try again: {e}")
                await asyncio.sleep(0.1)
            iterations += 1

    def get_applicable_interfaces(self) -> List[str]:
        return [
            ScryptedInterface.SecuritySystem.value,
            ScryptedInterface.DeviceProvider.value,
            ScryptedInterface.Settings.value,
            ScryptedInterface.Readme.value,
        ]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.SecuritySystem.value

    def get_builtin_child_device_manifests(self) -> List[Device]:
        siren = self.get_or_create_siren()
        return [
            {
                "info": {
                    "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                    "manufacturer": "Arlo",
                    "firmware": self.arlo_device.get("firmwareVersion"),
                    "serialNumber": self.arlo_device["deviceId"],
                },
                "nativeId": siren.nativeId,
                "name": f'{self.arlo_device["deviceName"]} Siren',
                "interfaces": siren.get_applicable_interfaces(),
                "type": siren.get_device_type(),
                "providerNativeId": self.nativeId,
            }
        ]

    async def getSettings(self) -> List[Setting]:
        return [
            {
                "key": "mode",
                "title": "Arm Mode",
                "description": "If disarmed, the associated siren will not be physically triggered even if toggled.",
                "value": self.mode,
                "choices": ArloSirenVirtualSecuritySystem.SUPPORTED_MODES,
            },
        ]

    async def putSetting(self, key: str, value: SettingValue) -> None:
        if key != "mode":
            raise ValueError(f"invalid setting {key}")
        self.mode = value
        if self.mode == SecuritySystemMode.Disarmed.value:
            await self.get_or_create_siren().turnOff()

    async def getReadmeMarkdown(self) -> str:
        return """
# Virtual Security System for Arlo Sirens

This security system device is not a real physical device, but a virtual, emulated device provided by the Arlo Scrypted plugin. Its purpose is to grant security system semantics of Arm/Disarm to avoid the accidental, unwanted triggering of the real physical siren through integrations such as Homekit.

To allow the siren to trigger, set the Arm Mode to any of the Armed options. When Disarmed, any triggers of the siren will be ignored. Switching modes will not perform any changes to Arlo cloud or your Arlo account, but rather only to this Scrypted device.

If this virtual security system is synced to Homekit, the siren device will be merged into the same security system accessory as a switch. The siren device will not be added as a separate accessory. To access the siren as a switch without the security system, disable syncing of the virtual security system and enable syncing of the siren, then ensure that the virtual security system is armed manually in its settings in Scrypted.
""".strip()

    async def getDevice(self, nativeId: str) -> ArloDeviceBase:
        if not nativeId.endswith("siren"):
            return None
        return self.get_or_create_siren()

    def get_or_create_siren(self) -> ArloSiren:
        siren_id = f'{self.arlo_device["deviceId"]}.siren'
        if not self.siren:
            self.siren = ArloSiren(siren_id, self.arlo_device, self.arlo_basestation, self.provider, self)
        return self.siren

    @async_print_exception_guard
    async def armSecuritySystem(self, mode: SecuritySystemMode) -> None:
        self.logger.info(f"Arming {mode}")
        self.mode = mode
        self.securitySystemState = {
            **self.securitySystemState,
            "mode": mode,
        }
        if mode == SecuritySystemMode.Disarmed.value:
            await self.get_or_create_siren().turnOff()

    @async_print_exception_guard
    async def disarmSecuritySystem(self) -> None:
        self.logger.info(f"Disarming")
        self.mode = SecuritySystemMode.Disarmed.value
        self.securitySystemState = {
            **self.securitySystemState,
            "mode": SecuritySystemMode.Disarmed.value,
        }
        await self.get_or_create_siren().turnOff()
