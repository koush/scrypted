import asyncio
from typing import List

from scrypted_sdk.types import OnOff, SecuritySystem, SecuritySystemMode, Setting, SettingValue, Settings, ScryptedInterface, ScryptedDeviceType

from .device_base import ArloDeviceBase
from .provider import ArloProvider


class ArloSiren(ArloDeviceBase, Settings, OnOff, SecuritySystem):

    SUPPORTED_MODES = [SecuritySystemMode.AwayArmed.value, SecuritySystemMode.HomeArmed.value, SecuritySystemMode.Disarmed.value]

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)

        self.create_task(self.delayed_init())

    async def delayed_init(self) -> None:
        while True:
            try:
                self.securitySystemState = {
                    "supportedModes": ArloSiren.SUPPORTED_MODES,
                }
                return
            except Exception as e:
                self.logger.info(f"Delayed init failed, will try again: {e}")
                await asyncio.sleep(0.1)

    def get_applicable_interfaces(self) -> List[str]:
        return [
            ScryptedInterface.SecuritySystem.value,
            ScryptedInterface.OnOff.value
        ]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.SecuritySystem.value
        return ScryptedDeviceType.Siren.value

    async def getSettings(self) -> List[Setting]:
        pass

    async def putSetting(self, key: str, value: SettingValue) -> None:
        pass

    async def turnOn(self) -> None:
        self.logger.info("Turning on")
        #self.provider.arlo.SirenOn(self.arlo_device)

    async def turnOff(self) -> None:
        self.logger.info("Turning off")
        #self.provider.arlo.SirenOff(self.arlo_device)

    async def armSecuritySystem(self, mode: SecuritySystemMode) -> None:
        self.logger.info(f"Arming {mode}")
        self.securitySystemState = {
            "mode": mode,
            "supportedModes": ArloSiren.SUPPORTED_MODES,
        }

    async def disarmSecuritySystem(self) -> None:
        self.logger.info(f"Disarming")
        self.securitySystemState = {
            "mode": SecuritySystemMode.Disarmed.value,
            "supportedModes": ArloSiren.SUPPORTED_MODES,
        }
