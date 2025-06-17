from __future__ import annotations

import asyncio
from typing import Any

import numpy as np
import onnxruntime
from PIL import Image
import threading

from predict.clip import ClipEmbedding
from scrypted_sdk import ObjectsDetected
import concurrent.futures
import sys
import platform


class ONNXClipEmbedding(ClipEmbedding):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def getFiles(self):
        return [
            "text.onnx",
            "vision.onnx",
        ]

    def loadModel(self, files):
        # find the xml file in the files list
        text_onnx = [f for f in files if f.lower().endswith('text.onnx')]
        if not text_onnx:
            raise ValueError("No onnx model file found in the provided files list")
        text_onnx = text_onnx[0]

        vision_onnx = [f for f in files if f.lower().endswith('vision.onnx')]
        if not vision_onnx:
            raise ValueError("No onnx model file found in the provided files list")
        vision_onnx = vision_onnx[0]
        

        compiled_models_array = []
        compiled_models = {}
        deviceIds = self.plugin.deviceIds

        for deviceId in deviceIds:
            sess_options = onnxruntime.SessionOptions()

            providers: list[str] = []
            if sys.platform == "darwin":
                providers.append("CoreMLExecutionProvider")

            if "linux" in sys.platform and platform.machine() == "x86_64":
                deviceId = int(deviceId)
                providers.append(("CUDAExecutionProvider", {"device_id": deviceId}))

            providers.append("CPUExecutionProvider")

            text_model = onnxruntime.InferenceSession(
                text_onnx, sess_options=sess_options, providers=providers
            )
            vision_model = onnxruntime.InferenceSession(
                vision_onnx, sess_options=sess_options, providers=providers
            )
            compiled_models_array.append((text_model, vision_model))

        def executor_initializer():
            thread_name = threading.current_thread().name
            interpreter = compiled_models_array.pop()
            compiled_models[thread_name] = interpreter
            print("Runtime initialized on thread {}".format(thread_name))

        executor = concurrent.futures.ThreadPoolExecutor(
            initializer=executor_initializer,
            max_workers=len(compiled_models_array),
            thread_name_prefix="custom",
        )

        return compiled_models, executor

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        compiled_models, executor = self.model
        def predict():
            inputs = self.processor(images=input, return_tensors="np", padding="max_length", truncation=True)
            compiled_model = compiled_models[threading.current_thread().name]
            _, vision_session = compiled_model
            vision_predictions = vision_session.run(None, {vision_session.get_inputs()[0].name: inputs.data['pixel_values']})
            image_embeds = vision_predictions[0]
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

        objs = await asyncio.get_event_loop().run_in_executor(
            executor, predict
        )
        return objs

    async def getTextEmbedding(self, input):
        compiled_models, executor = self.model
        def predict():
            inputs = self.processor(text=input, return_tensors="np", padding="max_length", truncation=True)
            compiled_model = compiled_models[threading.current_thread().name]
            text_session, _ = compiled_model
            text_inputs = {
                text_session.get_inputs()[0].name: inputs['input_ids'],
                text_session.get_inputs()[1].name: inputs['attention_mask']
            }
            text_predictions = text_session.run(None, text_inputs)
            text_embeds = text_predictions[0]
            return bytearray(text_embeds.astype(np.float32).tobytes())

        objs = await asyncio.get_event_loop().run_in_executor(
            executor, predict
        )
        return objs