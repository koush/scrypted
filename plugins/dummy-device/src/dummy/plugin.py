import asyncio
import uuid
from typing import List

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import DeviceProvider, DeviceCreator, DeviceCreatorSettings, Setting, ScryptedDeviceType, ScryptedInterface

from .device import DummyDevice, SUPPORTED_TYPES


class DummyDevicePlugin(ScryptedDeviceBase, DeviceProvider, DeviceCreator):
    devices: dict
    devices_lock: asyncio.Lock

    def __init__(self, nativeId: str = None):
        super().__init__(nativeId)
        self.devices = {}
        self.devices_lock = asyncio.Lock()

    async def getCreateDeviceSettings(self) -> List[Setting]:
        return [
            {
                "key": "name",
                "title": "Dummy Device Name",
                "placeholder": "My Dummy Device",
            },
            {
                "key": "type",
                "title": "Device Type",
                "choices": SUPPORTED_TYPES,
            }
        ]

    async def createDevice(self, settings: DeviceCreatorSettings) -> str:
        if settings.get("name", "") == "":
            raise Exception("cannot create device with empty name")
        if settings.get("type", "") == "":
            raise Exception("cannot create device with empty type")

        id = str(uuid.uuid4())
        await scrypted_sdk.deviceManager.onDeviceDiscovered({
            "nativeId": id,
            "name": settings["name"],
            "interfaces": [ScryptedInterface.Settings.value],
            "type": settings["type"],
        })

    async def getDevice(self, nativeId: str) -> DummyDevice:
        async with self.devices_lock:
            if nativeId not in self.devices:
                self.devices[nativeId] = DummyDevice(nativeId)
            return self.devices[nativeId]

    async def releaseDevice(self, id: str, nativeId: str) -> None:
        pass