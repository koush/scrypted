from __future__ import annotations

from typing import List, TYPE_CHECKING

from scrypted_sdk.types import OnOff, SecuritySystemMode, ScryptedInterface, ScryptedDeviceType

from .base import ArloDeviceBase
from .util import async_print_exception_guard

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider
    from .vss import ArloSirenVirtualSecuritySystem


class ArloSiren(ArloDeviceBase, OnOff):
    vss: ArloSirenVirtualSecuritySystem = None

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider, vss: ArloSirenVirtualSecuritySystem) -> None:
        super().__init__(nativeId=nativeId, arlo_device=arlo_device, arlo_basestation=arlo_basestation, provider=provider)
        self.vss = vss

    def get_applicable_interfaces(self) -> List[str]:
        return [ScryptedInterface.OnOff.value]

    def get_device_type(self) -> str:
        return ScryptedDeviceType.Siren.value

    @async_print_exception_guard
    async def turnOn(self) -> None:
        from .basestation import ArloBasestation
        self.logger.info("Turning on")

        if self.vss.securitySystemState["mode"] == SecuritySystemMode.Disarmed.value:
            self.logger.info("Virtual security system is disarmed, ignoring trigger")

            # set and unset this property to force homekit to display the
            # switch as off
            self.on = True
            self.on = False
            self.vss.securitySystemState = {
                **self.vss.securitySystemState,
                "triggered": False,
            }
            return

        if isinstance(self.vss.parent, ArloBasestation):
            self.logger.debug("Parent device is a basestation")
            self.provider.arlo.SirenOn(self.arlo_basestation)
        else:
            self.logger.debug("Parent device is a camera")
            self.provider.arlo.SirenOn(self.arlo_basestation, self.arlo_device)

        self.on = True
        self.vss.securitySystemState = {
            **self.vss.securitySystemState,
            "triggered": True,
         }

    @async_print_exception_guard
    async def turnOff(self) -> None:
        from .basestation import ArloBasestation
        self.logger.info("Turning off")
        if isinstance(self.vss.parent, ArloBasestation):
            self.provider.arlo.SirenOff(self.arlo_basestation)
        else:
            self.provider.arlo.SirenOff(self.arlo_basestation, self.arlo_device)
        self.on = False
        self.vss.securitySystemState = {
            **self.vss.securitySystemState,
            "triggered": False,
         }
