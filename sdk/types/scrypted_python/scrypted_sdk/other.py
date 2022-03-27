from __future__ import annotations
from typing import Any, Set, TypedDict
from typing import Callable

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

    def getKeys(self) -> Set[str]:
        pass

    def clear(self):
        pass


class MediaObject:
    mimeType: str


class RTCSessionDescriptionInit(TypedDict):
    pass
