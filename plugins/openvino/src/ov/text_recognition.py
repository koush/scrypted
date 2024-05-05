from __future__ import annotations

import openvino.runtime as ov
import numpy as np

from predict.text_recognize import TextRecognition


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

    def predictDetectModel(self, input):
        infer_request = self.detectModel.create_infer_request()
        im = ov.Tensor(array=input)
        input_tensor = im
        infer_request.set_input_tensor(input_tensor)
        infer_request.start_async()
        infer_request.wait()
        return infer_request.output_tensors[0].data

    def predictTextModel(self, input):
        input = input.astype(np.float32)
        im = ov.Tensor(array=input)
        infer_request = self.textModel.create_infer_request()
        infer_request.set_input_tensor(im)
        infer_request.start_async()
        infer_request.wait()
        return infer_request.output_tensors[0].data
