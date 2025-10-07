from __future__ import annotations

import asyncio
from typing import Any

import numpy as np
import openvino as ov
from PIL import Image

from ov import async_infer
from predict.clip import ClipEmbedding
from scrypted_sdk import ObjectsDetected

clipPrepare, clipPredict = async_infer.create_executors("ClipPredict")


# _int8 is available but seems slower in addition to the accuracy loss.
model_suffix = ""
text_xml_name = f"text{model_suffix}.xml"
vision_xml_name = f"vision{model_suffix}.xml"

class OpenVINOClipEmbedding(ClipEmbedding):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def getFiles(self):
        return [
            f"openvino/{text_xml_name}",
            f"openvino/text{model_suffix}.bin",
            f"openvino/{vision_xml_name}",
            f"openvino/vision{model_suffix}.bin"
        ]

    def loadModel(self, files):
        # find the xml file in the files list
        text_xml = [f for f in files if f.lower().endswith(text_xml_name)]
        if not text_xml:
            raise ValueError("No XML model file found in the provided files list")
        text_xml = text_xml[0]

        vision_xml = [f for f in files if f.lower().endswith(vision_xml_name)]
        if not vision_xml:
            raise ValueError("No XML model file found in the provided files list")
        vision_xml = vision_xml[0]
        
        textModel = self.plugin.core.compile_model(text_xml, self.plugin.mode)
        model = self.plugin.core.read_model(vision_xml)
        # for some reason this is exporting as dynamic axes and causing npu to crash
        model.reshape([1, 3, 224, 224])
        visionModel = self.plugin.core.compile_model(model, self.plugin.mode)
        return textModel, visionModel

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def predict():
            inputs = self.processor(images=input, return_tensors="np", padding="max_length", truncation=True)
            _, vision_model = self.model
            vision_predictions = vision_model(inputs.data['pixel_values'])
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

        ret = await asyncio.get_event_loop().run_in_executor(
            clipPredict, lambda: predict()
        )
        return ret

    async def getTextEmbedding(self, input):
        def predict():
            inputs = self.processor(text=input, return_tensors="np", padding="max_length", truncation=True)
            text_model, _ = self.model
            text_predictions = text_model((inputs.data['input_ids'], inputs.data['attention_mask']))
            text_embeds = text_predictions[0]
            return bytearray(text_embeds.astype(np.float32).tobytes())

        ret = await asyncio.get_event_loop().run_in_executor(
            clipPredict, lambda: predict()
        )
        return ret
