from __future__ import annotations
from .types import *

deviceManager: DeviceManager = None
systemManager: SystemManager = None

def sdk_init(sm: DeviceManager, dm: SystemManager):
    global systemManager
    global deviceManager
    systemManager = sm
    deviceManager = dm

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
