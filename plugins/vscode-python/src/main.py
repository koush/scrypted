from __future__ import annotations
from typing import Any
import scrypted_sdk
import asyncio

from scrypted_sdk.types import DeviceProvider, OnOff, ScryptedDeviceType, ScryptedInterface

class PythonLight(scrypted_sdk.ScryptedDeviceBase, OnOff):
    def __init__(self, nativeId: str | None):
        super().__init__(nativeId=nativeId)

    async def turnOff(self) -> None:
        self.print("turned off!")
        self.on = False

    async def turnOn(self) -> None:
        self.print("turned on!")
        self.on = True

class PythonDeviceProvider(scrypted_sdk.ScryptedDeviceBase, DeviceProvider):
    def __init__(self):
        super().__init__()

        asyncio.run_coroutine_threadsafe(scrypted_sdk.deviceManager.onDevicesChanged({
            'devices': [
                {
                    'nativeId': 'light',
                    'interfaces': [ScryptedInterface.OnOff.value],
                    'type': ScryptedDeviceType.Light.value,
                }
            ]
        }), asyncio.get_event_loop())

    async def getDevice(self, nativeId: str) -> Any:
        return PythonLight(nativeId)

def create_scrypted_plugin():
    return PythonDeviceProvider()
