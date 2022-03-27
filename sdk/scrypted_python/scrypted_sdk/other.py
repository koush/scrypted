from __future__ import annotations
from typing import Any, TypedDict
from typing import Callable

SettingValue = str
EventListener = Callable[[Any, Any, Any], None]

class Console:
    pass

class Storage:
    pass

class MediaObject:
    mimeType: str

class RTCSessionDescriptionInit(TypedDict):
    pass
