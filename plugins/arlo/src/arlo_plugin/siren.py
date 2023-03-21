from typing import List

from scrypted_sdk.types import OnOff, SecuritySystem, SecuritySystemMode, Setting, SettingValue, Settings, ScryptedInterface, ScryptedDeviceType

from .device_base import ArloDeviceBase


class ArloSiren(ArloDeviceBase, Settings, OnOff, SecuritySystem):

    def get_applicable_interfaces(self) -> List[str]:
        return [ScryptedInterface.OnOff.value]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.Siren.value

    async def getSettings(self) -> List[Setting]:
        pass

    async def putSetting(self, key: str, value: SettingValue) -> None:
        pass

    async def turnOn(self) -> None:
        self.logger.info("Turning on")
        self.provider.arlo.SirenOn(self.arlo_device)

    async def turnOff(self) -> None:
        self.logger.info("Turning off")
        self.provider.arlo.SirenOff(self.arlo_device)

    async def armSecuritySystem(self, mode: SecuritySystemMode) -> None:
        pass
    async def disarmSecuritySystem(self) -> None:
        pass