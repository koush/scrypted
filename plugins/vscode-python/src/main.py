from __future__ import annotations
import scrypted_sdk

from scrypted_sdk.types import OnOff

class PythonLight(scrypted_sdk.ScryptedDeviceBase, OnOff):
    async def turnOff(self) -> None:
        print("turned off!")
        self.on = False

    async def turnOn(self) -> None:
        print("turned on!")
        self.on = True

def create_scrypted_plugin():
    return PythonLight()
