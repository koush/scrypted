from typing import Any
from scrypted_sdk import systemManager, remote
import asyncio
from opencv import OpenCVPlugin

def create_scrypted_plugin():
    return OpenCVPlugin()
