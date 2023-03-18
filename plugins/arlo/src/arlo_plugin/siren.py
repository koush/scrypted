from scrypted_sdk.types import OnOff, ScryptedInterface

from .device_base import ArloDeviceBase


class ArloSiren(ArloDeviceBase, OnOff):

    def get_applicable_interfaces(self) -> list:
        return [ScryptedInterface.OnOff.value]

    async def turnOn(self) -> None:
        self.logger.info("Turning on")
        self.provider.arlo.SirenOn(self.arlo_device)

    async def turnOff(self) -> None:
        self.logger.info("Turning off")
        self.provider.arlo.SirenOff(self.arlo_device)