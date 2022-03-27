from __future__ import annotations
from typing import Any, Set, TypedDict
from typing import Callable

SettingValue = str
EventListener = Callable[[Any, Any, Any], None]


class Console:
    pass


class Storage:
    def getItem(key: str) -> str:
        pass

    def setItem(key: str, value: str):
        pass

    def removeItem(key: str):
        pass

    def getKeys() -> Set[str]:
        pass

    def clear():
        pass


class MediaObject:
    mimeType: str


class RTCSessionDescriptionInit(TypedDict):
    pass
