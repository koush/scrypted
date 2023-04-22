from typing import List

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import (
    ScryptedInterface,
    Settings,
    Setting,
    SettingValue,
    Battery,
    Charger,
    ChargeState,
)


SUPPORTED_INTERFACES = [
    ScryptedInterface.Battery.value,
    ScryptedInterface.Charger.value,
]


class DummyDevice(ScryptedDeviceBase, Settings, Battery, Charger):

    async def getSettings(self) -> List[Setting]:
        settings: List[Setting] = [
            {
                "group": "General",
                "key": "interfaces",
                "title": "Scrypted Interfaces",
                "description": "Choice of the supported Scrypted interfaces that this device should implement.",
                "value": self.providedInterfaces,
                "choices": SUPPORTED_INTERFACES,
                "multiple": True,
            }
        ]

        if ScryptedInterface.Battery.value in self.interfaces:
            settings.extend([
                {
                    "group": ScryptedInterface.Battery.value,
                    "key": "batteryLevel",
                    "title": "Battery Level",
                    "description": "The device's battery percentage level, from 0 to 100.",
                    "value": self.batteryLevel,
                    "type": "number",
                }
            ])
        if ScryptedInterface.Charger.value in self.interfaces:
            settings.extend([
                {
                    "group": ScryptedInterface.Charger.value,
                    "key": "chargeState",
                    "title": "Charge State",
                    "description": "The device's charge state, one of the available options.",
                    "value": self.chargeState,
                    "choices": [c.value for c in ChargeState],
                }
            ])

        return settings

    async def putSetting(self, key: str, value: SettingValue) -> None:
        if key == "interfaces":
            await scrypted_sdk.deviceManager.onDeviceDiscovered({
                "nativeId": self.nativeId,
                "name": self.name,
                "interfaces": value,
                "type": self.type,
            })
        else:
            setattr(self, key, value)
        await self.onDeviceEvent(ScryptedInterface.Settings.value, None)
