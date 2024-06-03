from __future__ import annotations

import asyncio

import numpy as np
import openvino.runtime as ov

from ov import async_infer
from predict.text_recognize import TextRecognition

textDetectPrepare, textDetectPredict = async_infer.create_executors("TextDetect")
textRecognizePrepare, textRecognizePredict = async_infer.create_executors(
    "TextRecognize"
)


class OpenVINOTextRecognition(TextRecognition):
    def __init__(self, plugin, nativeId: str | None = None):
        self.plugin = plugin

        super().__init__(nativeId=nativeId)

    def downloadModel(self, model: str):
        ovmodel = "best"
        precision = self.plugin.precision
        model_version = "v5"
        xmlFile = self.downloadFile(
            f"https://raw.githubusercontent.com/koush/openvino-models/main/{model}/{precision}/{ovmodel}.xml",
            f"{model_version}/{model}/{precision}/{ovmodel}.xml",
        )
        binFile = self.downloadFile(
            f"https://raw.githubusercontent.com/koush/openvino-models/main/{model}/{precision}/{ovmodel}.bin",
            f"{model_version}/{model}/{precision}/{ovmodel}.bin",
        )
        print(xmlFile, binFile)
        return self.plugin.core.compile_model(xmlFile, self.plugin.mode)

    async def predictDetectModel(self, input: np.ndarray):
        def predict():
            infer_request = self.detectModel.create_infer_request()
            im = ov.Tensor(array=input)
            input_tensor = im
            infer_request.set_input_tensor(input_tensor)
            output_tensors = infer_request.infer()
            ret = output_tensors[0]
            return ret

        ret = await asyncio.get_event_loop().run_in_executor(
            textDetectPredict, lambda: predict()
        )
        return ret

    async def predictTextModel(self, input: np.ndarray):
        def predict():
            im = ov.Tensor(array=input.astype(np.float32))
            infer_request = self.textModel.create_infer_request()
            infer_request.set_input_tensor(im)
            output_tensors = infer_request.infer()
            ret = output_tensors[0]
            return ret

        ret = await asyncio.get_event_loop().run_in_executor(
            textDetectPredict, lambda: predict()
        )
        return ret
