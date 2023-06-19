from __future__ import annotations

from typing import List, TYPE_CHECKING

from scrypted_sdk.types import OnOff, ScryptedInterface, ScryptedDeviceType

from .base import ArloDeviceBase
from .util import async_print_exception_guard

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider
    from .camera import ArloCamera


class ArloSpotlight(ArloDeviceBase, OnOff):
    camera: ArloCamera = None

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider, camera: ArloCamera) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)
        self.camera = camera

    def get_applicable_interfaces(self) -> List[str]:
        return [ScryptedInterface.OnOff.value]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.Light.value

    @async_print_exception_guard
    async def turnOn(self) -> None:
        self.logger.info("Turning on")
        self.provider.arlo.SpotlightOn(self.arlo_basestation, self.arlo_device)
        self.on = True

    @async_print_exception_guard
    async def turnOff(self) -> None:
        self.logger.info("Turning off")
        self.provider.arlo.SpotlightOff(self.arlo_basestation, self.arlo_device)
        self.on = False


class ArloFloodlight(ArloSpotlight):

    @async_print_exception_guard
    async def turnOn(self) -> None:
        self.logger.info("Turning on")
        self.provider.arlo.FloodlightOn(self.arlo_basestation, self.arlo_device)
        self.on = True

    @async_print_exception_guard
    async def turnOff(self) -> None:
        self.logger.info("Turning off")
        self.provider.arlo.FloodlightOff(self.arlo_basestation, self.arlo_device)
        self.on = False


class ArloNightlight(ArloSpotlight):

    def __init__(self, nativeId: str, arlo_device: dict, provider: ArloProvider, camera: ArloCamera) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_device, provider=provider, camera=camera)

    @async_print_exception_guard
    async def turnOn(self) -> None:
        self.logger.info("Turning on")
        self.provider.arlo.NightlightOn(self.arlo_device)
        self.on = True

    @async_print_exception_guard
    async def turnOff(self) -> None:
        self.logger.info("Turning off")
        self.provider.arlo.NightlightOff(self.arlo_device)
        self.on = False