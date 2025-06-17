from __future__ import annotations

import asyncio
from urllib.parse import urlparse, urlunparse
from typing import Any, List, Tuple
import json
import base64

import numpy as np
from PIL import Image
from scrypted_sdk import ObjectDetectionResult, ObjectDetectionSession, ObjectsDetected
import scrypted_sdk
from transformers import CLIPProcessor

from common import yolo
from predict import PredictPlugin
from common import softmax
import os


class ClipEmbedding(PredictPlugin, scrypted_sdk.TextEmbedding, scrypted_sdk.ImageEmbedding):
    def __init__(self, plugin: PredictPlugin, nativeId: str):
        super().__init__(nativeId=nativeId, plugin=plugin)

        self.inputwidth = 224
        self.inputheight = 224

        self.labels = {}
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.5

        self.model = self.initModel()
        self.processor = CLIPProcessor.from_pretrained(
            "openai/clip-vit-base-patch32",
            cache_dir=os.path.join(os.environ["SCRYPTED_PLUGIN_VOLUME"], "files", "hf"),
        )

    def getFiles(self):
        pass

    def initModel(self):
        local_files: list[str] = []
        for file in self.getFiles():
            remote_file = "https://huggingface.co/koushd/clip/resolve/main/" + file
            localFile = self.downloadFile(remote_file, f"{self.id}/{file}")
            local_files.append(localFile)
        return self.loadModel(local_files)

    def loadModel(self, files: list[str]):
        pass

    async def getImageEmbedding(self, input):
        detections = await super().detectObjects(input, None)
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
