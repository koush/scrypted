from __future__ import annotations

import asyncio
import base64
import hashlib
from typing import Tuple

import scrypted_sdk
from transformers import CLIPProcessor

from predict import PredictPlugin


class ClipEmbedding(PredictPlugin, scrypted_sdk.TextEmbedding, scrypted_sdk.ImageEmbedding):
    def __init__(self, plugin: PredictPlugin, nativeId: str):
        super().__init__(nativeId=nativeId, plugin=plugin)

        hf_id = "openai/clip-vit-base-patch32"

        self.inputwidth = 224
        self.inputheight = 224

        self.labels = {}
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.5

        self.model = self.initModel()

        self.processor = None
        print("Loading CLIP processor from local cache.")
        try:
            self.processor = CLIPProcessor.from_pretrained(
                hf_id,
                local_files_only=True,
            )
            print("Loaded CLIP processor from local cache.")
        except Exception:
            print("CLIP processor not available in local cache yet.")

        asyncio.ensure_future(self.refreshClipProcessor(hf_id), loop=self.loop)

    async def refreshClipProcessor(self, hf_id: str):
        try:
            print("Refreshing CLIP processor cache (online).")
            processor = await asyncio.to_thread(
                CLIPProcessor.from_pretrained,
                hf_id,
            )
            self.processor = processor
            print("Refreshed CLIP processor cache.")
        except Exception:
            print("CLIP processor cache refresh failed.")

    def getFiles(self):
        pass

    def initModel(self):
        local_files: list[str] = []
        plugin_suffix = self.pluginId.split('/')[1]
        for file in self.getFiles():
            remote_file = "https://huggingface.co/koushd/clip/resolve/main/" + file
            url_hash = hashlib.sha256(remote_file.encode()).hexdigest()[:12]
            localFile = self.downloadFile(remote_file, f"{plugin_suffix}/{url_hash}/{file}")
            local_files.append(localFile)
        return self.loadModel(local_files)

    def loadModel(self, files: list[str]):
        pass

    async def getImageEmbedding(self, input):
        detections = await super().detectObjects(input, {
            "settings": {
                "pad": True,
            }
        })
        return detections["detections"][0]["embedding"]
    
    async def detectObjects(self, mediaObject, session = None):
        ret = await super().detectObjects(mediaObject, session)
        embedding = ret["detections"][0]['embedding']
        ret["detections"][0]['embedding'] = base64.b64encode(embedding).decode("utf-8")
        return ret

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def get_input_format(self) -> str:
        return "rgb"
