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
    async def log(level: str, message: str) -> None:
        pass

    async def clear() -> None:
        pass

    async def clearAlert(message: str) -> None:
        pass

    async def clearAlerts() -> None:
        pass



class PluginAPI:
    async def setState(nativeId: str | None, key: str, value: Any) -> None:
        pass

    async def onDevicesChanged(deviceManifest: "DeviceManifest") -> None:
        pass

    async def onDeviceDiscovered(device: "Device") -> None:
        pass

    async def onDeviceEvent(nativeId: str | None, eventInterface: str, eventData: Any) -> None:
        pass

    async def onMixinEvent(id: str, nativeId: str | None, eventInterface: str, eventData: Any) -> None:
        pass

    async def onDeviceRemoved(nativeId: str) -> None:
        pass

    async def setStorage(nativeId: str, storage: dict[str, Any]) -> None:
        pass

    async def getDeviceById(id: str) -> "ScryptedDevice":
        pass

    async def setDeviceProperty(id: str, property: "ScryptedInterfaceProperty", value: Any) -> None:
        pass

    async def removeDevice(id: str) -> None:
        pass

    async def listen(callback: Callable[[str, "EventDetails", Any], None]) -> "EventListenerRegister":
        pass

    async def listenDevice(id: str, event: str | "EventListenerOptions", callback: Callable[["EventDetails", Any], None]) -> "EventListenerRegister":
        pass


    async def getLogger(nativeId: str | None) -> PluginLogger:
        pass

    async def getComponent(id: str) -> Any:
        pass

    async def getMediaManager() -> "MediaManager":
        pass

    async def requestRestart() -> None:
        pass

    async def setScryptedInterfaceDescriptors(typesVersion: str, descriptors: dict[str, ScryptedInterfaceDescriptor]) -> None:
        pass
