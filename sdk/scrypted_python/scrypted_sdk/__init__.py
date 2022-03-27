from __future__ import annotations
from .types import *
from typing import Optional
from zipfile import ZipFile
import sys

deviceManager: DeviceManager = None
systemManager: SystemManager = None
mediaManager: MediaManager = None
zip: ZipFile = None
remote: Any = None

def sdk_init(z: ZipFile, r, sm: DeviceManager, dm: SystemManager, mm: MediaManager):
    global zip
    global remote
    global systemManager
    global deviceManager
    global mediaManager
    systemManager = sm
    deviceManager = dm
    mediaManager = mm
    zip = z
    remote = r

class ScryptedDeviceBase(DeviceState):
    nativeId: str | None
    deviceState: DeviceState = None

    def __init__(self, nativeId: str | None = None):
        self.nativeId = nativeId

    def getScryptedProperty(self, property: str) -> Any:
        if not self.deviceState:
            global deviceManager
            self.deviceState = deviceManager.getDeviceState(self.nativeId)
        return getattr(self.deviceState, property, None)

    def setScryptedProperty(self, property: str, value: Any):
        if not self.deviceState:
            global deviceManager
            self.deviceState = deviceManager.getDeviceState(self.nativeId)
        setattr(self.deviceState, property, value)

    async def onDeviceEvent(self, interface: ScryptedInterface, eventData: Any):
        await deviceManager.onDeviceEvent(self.nativeId, interface, eventData)

    @property
    def storage(self):
        return deviceManager.getDeviceStorage(self.nativeId)

    def print(self, *values: object, sep: Optional[str] = ' ',
            end: Optional[str] = '\n',
            flush: bool = True):
        print(*values, sep=sep, end=end, flush=True)
        remote.print(self.nativeId, *values, sep=sep, end=end, flush=flush)
