from __future__ import annotations
from .types import *
import zipfile

deviceManager: DeviceManager = None
systemManager: SystemManager = None
mediaManager: MediaManager = None
zip: zipfile.ZipFile = None

def sdk_init(z: zipfile.ZipFile, sm: DeviceManager, dm: SystemManager, mm: MediaManager):
    global zip
    global systemManager
    global deviceManager
    global mediaManager
    systemManager = sm
    deviceManager = dm
    mediaManager = mm
    zip = z

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
