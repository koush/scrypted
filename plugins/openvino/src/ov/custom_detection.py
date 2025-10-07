from __future__ import annotations

import asyncio

import numpy as np
import openvino as ov
from PIL import Image

from ov import async_infer
from predict.custom_detect import CustomDetection
from scrypted_sdk import ObjectsDetected

customDetectPrepare, customDetectPredict = async_infer.create_executors("CustomDetect")


class OpenVINOCustomDetection(CustomDetection):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)
        self.prefer_relu = True

    def loadModel(self, files: list[str]):
        # find the xml file in the files list
        xml_files = [f for f in files if f.lower().endswith('.xml')]
        if not xml_files:
            raise ValueError("No XML model file found in the provided files list")
        xmlFile = xml_files[0]
        
        return self.plugin.core.compile_model(xmlFile, self.plugin.mode)

    async def predictModel(self, input: Image.Image) -> ObjectsDetected:
        def predict():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0

            if self.model_config.get("mean", None) and self.model_config.get("std", None):
                mean = np.array(self.model_config["mean"]).astype(np.float32)
                std = np.array(self.model_config["std"]).astype(np.float32)
                mean = mean.reshape(1, -1, 1, 1)
                std = std.reshape(1, -1, 1, 1)
                im = (im - mean) / std
                im = im.astype(np.float32)

            im = np.ascontiguousarray(im)

            infer_request = self.model.create_infer_request()
            tensor = ov.Tensor(array=im)
            infer_request.set_input_tensor(tensor)
            output_tensors = infer_request.infer()
            ret = output_tensors[0][0]
            return ret

        ret = await asyncio.get_event_loop().run_in_executor(
            customDetectPredict, lambda: predict()
        )
        return ret
