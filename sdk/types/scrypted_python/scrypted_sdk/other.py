from __future__ import annotations

from enum import Enum
from typing import AbstractSet, Any, Callable, Literal, Union, TYPE_CHECKING
try:
    from typing import TypedDict
except:
    from typing_extensions import TypedDict


if TYPE_CHECKING:
    from .types import DeviceManifest, Device, EventDetails, EventListenerOptions, EventListenerRegister, MediaManager, ScryptedDevice, ScryptedInterfaceProperty

SettingValue = str
EventListener = Callable[[Any, Any, Any], None]
VibratePattern = list[int]


class Console:
    pass


class Storage:
    def getItem(self, key: str) -> str:
        pass

    def setItem(self, key: str, value: str):
        pass

    def removeItem(self, key: str):
        pass

    def getKeys(self) -> AbstractSet[str]:
        pass

    def clear(self):
        pass


class MediaObject:
    mimeType: str


class RTCSessionDescriptionInit(TypedDict):
    pass


class NotificationAction(TypedDict, total=False):

    action: str
    title: str
    icon: str  # optional


class NotificationDirection(str, Enum):

    auto = "auto"
    ltr = "ltr"
    rtl = "rtl"


class WebSocket:

    CLOSED: int
    CLOSING: int
    CONNECTING: int
    EventTarget: dict
    OPEN: int
    binaryType: Literal["blob", "arraybuffer"]
    bufferedAmount: int
    extensions: str
    onclose: Callable[[dict], None]
    onerror: Callable[[dict], None]
    onmessage: Callable[[dict], None]
    onopen: Callable[[dict], None]
    protocol: str
    readyState: int
    url: str

    def addEventListener(self, type: str, listener: Callable[[dict], None], options: dict = None) -> None:
        pass

    def close(self, code: int = None, reason: str = None) -> None:
        pass

    def dispatchEvent(self, event: dict) -> bool:
        pass

    def removeEventListener(self, type: str, listener: Callable[[dict], None], options: dict = None) -> None:
        pass

    def send(self, data: str | bytes | bytearray | int | float | bool) -> None:
        pass


class ScryptedInterfaceDescriptor:
    name: str
    properties: list[str]
    methods: list[str]


class PluginLogger:
    async def log(self, level: str, message: str) -> None:
        pass

    async def clear(self) -> None:
        pass

    async def clearAlert(self, message: str) -> None:
        pass

    async def clearAlerts(self) -> None:
        pass



class PluginAPI:
    async def setState(nativeId: str | None, key: str, value: Any) -> None:
        pass

    async def onDevicesChanged(self, deviceManifest: "DeviceManifest") -> None:
        pass

    async def onDeviceDiscovered(self, device: "Device") -> None:
        pass

    async def onDeviceEvent(self, nativeId: str | None, eventInterface: str, eventData: Any) -> None:
        pass

    async def onMixinEvent(self, id: str, nativeId: str | None, eventInterface: str, eventData: Any) -> None:
        pass

    async def onDeviceRemoved(self, nativeId: str) -> None:
        pass

    async def setStorage(self, nativeId: str, storage: dict[str, Any]) -> None:
        pass

    async def getDeviceById(self, id: str) -> "ScryptedDevice":
        pass

    async def setDeviceProperty(self, id: str, property: "ScryptedInterfaceProperty", value: Any) -> None:
        pass

    async def removeDevice(self, id: str) -> None:
        pass

    async def listen(self, callback: Callable[[str, "EventDetails", Any], None]) -> "EventListenerRegister":
        pass

    async def listenDevice(self, id: str, event: str | "EventListenerOptions", callback: Callable[["EventDetails", Any], None]) -> "EventListenerRegister":
        pass


    async def getLogger(self, nativeId: str | None) -> PluginLogger:
        pass

    async def getComponent(self, id: str) -> Any:
        pass

    async def getMediaManager(self) -> "MediaManager":
        pass

    async def requestRestart(self) -> None:
        pass

    async def setScryptedInterfaceDescriptors(self, typesVersion: str, descriptors: dict[str, ScryptedInterfaceDescriptor]) -> None:
        pass
