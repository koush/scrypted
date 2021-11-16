from __future__ import annotations
import scrypted_python.scrypted_sdk
from scrypted_python.scrypted_sdk.types import MediaObject, ScryptedInterfaceProperty
from collections.abc import Mapping
from genericpath import exists
import asyncio
import json
import aiofiles
import os
from typing import TypedDict
import base64
from os import sys
import time
import zipfile
import subprocess
from typing import Any

class MediaObjectRemote:
    pass

class MediaManager(scrypted_python.scrypted_sdk.MediaManager):
    def __init__(self, api: Any) -> None:
        super().__init__()
        self.api = api

    async def getFFmpegPath(self) -> str:
        v = os.environ.get('SCRYPTED_FFMPEG_PATH_ENV_VARIABLE', None)
        if v:
            ffmpeg = os.environ.get(v, None)
            if ffmpeg and os.path.exists(ffmpeg):
                return ffmpeg
        
        ffmpeg = os.environ.get('SCRYPTED_FFMPEG_PATH', None)
        if ffmpeg and os.path.exists(ffmpeg):
            return ffmpeg
        return os.path.join(os.getcwd(), 'node_modules/ffmpeg-for-homebridge/ffmpeg')

    async def convertMediaObjectToBuffer(self, mediaObject: MediaObject, toMimeType: str) -> bytearray:
        intermediate = await self.api.convert(mediaObject)
        converted = self.createMediaObject(intermediate.data)
