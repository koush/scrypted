from __future__ import annotations
from typing import AbstractSet, Any, Callable
from typing_extensions import TypedDict

SettingValue = str
EventListener = Callable[[Any, Any, Any], None]


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
