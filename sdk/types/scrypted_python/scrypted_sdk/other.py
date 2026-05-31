from __future__ import annotations

from enum import Enum
from typing import AbstractSet, Any, Callable, Literal, Union
try:
    from typing import TypedDict
except:
    from typing_extensions import TypedDict

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