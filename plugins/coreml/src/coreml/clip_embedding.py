from __future__ import annotations

import asyncio
import concurrent.futures
import os
from typing import Any

import coremltools as ct
import numpy as np
from PIL import Image
from scrypted_sdk import ObjectsDetected

from predict.clip import ClipEmbedding


class CoreMLClipEmbedding(ClipEmbedding):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)
        self.predictExecutor = concurrent.futures.ThreadPoolExecutor(1, "predict-clip")

    def getFiles(self):
        return [
            "text.mlpackage/Manifest.json",
            "text.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
            "text.mlpackage/Data/com.apple.CoreML/model.mlmodel",

            "vision.mlpackage/Manifest.json",
            "vision.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
            "vision.mlpackage/Data/com.apple.CoreML/model.mlmodel",
        ]

    def loadModel(self, files):
        # find the xml file in the files list
        text_manifest = [f for f in files if f.lower().endswith('text.mlpackage/manifest.json')]
        if not text_manifest:
            raise ValueError("No XML model file found in the provided files list")
        text_manifest = text_manifest[0]

        vision_manifest = [f for f in files if f.lower().endswith('vision.mlpackage/manifest.json')]
        if not vision_manifest:
            raise ValueError("No XML model file found in the provided files list")
        vision_manifest = vision_manifest[0]
        

        textModel = ct.models.MLModel(os.path.dirname(text_manifest))
        visionModel = ct.models.MLModel(os.path.dirname(vision_manifest))

        return textModel, visionModel

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def predict():
            inputs = self.processor(images=input, return_tensors="np", padding="max_length", truncation=True)
            _, vision_model = self.model
            vision_predictions = vision_model.predict({'x': inputs['pixel_values']})
            image_embeds = vision_predictions['var_877']
            # this is a hack to utilize the existing image massaging infrastructure
            embedding = bytearray(image_embeds.astype(np.float32).tobytes())
            ret: ObjectsDetected = {
                "detections": [
                    {
                        "embedding": embedding,
                    }
                ],
                "inputDimensions": src_size
            }

            return ret

        ret = await asyncio.get_event_loop().run_in_executor(
            self.predictExecutor, lambda: predict()
        )
        return ret

    async def getTextEmbedding(self, input):
        def predict():
            inputs = self.processor(text=input, return_tensors="np", padding="max_length", truncation=True)
            text_model, _ = self.model
            text_predictions = text_model.predict({'input_ids_1': inputs['input_ids'].astype(np.float32), 'attention_mask_1': inputs['attention_mask'].astype(np.float32)})
            text_embeds = text_predictions['var_1050']
            return bytearray(text_embeds.astype(np.float32).tobytes())

        ret = await asyncio.get_event_loop().run_in_executor(
            self.predictExecutor, lambda: predict()
        )
        return ret
