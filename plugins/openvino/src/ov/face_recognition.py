from __future__ import annotations

import asyncio

import numpy as np
import openvino.runtime as ov
from PIL import Image

from ov import async_infer
from predict.face_recognize import FaceRecognizeDetection

faceDetectPrepare, faceDetectPredict = async_infer.create_executors("FaceDetect")
faceRecognizePrepare, faceRecognizePredict = async_infer.create_executors(
    "FaceRecognize"
)


class OpenVINOFaceRecognition(FaceRecognizeDetection):
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

    async def predictDetectModel(self, input: Image.Image):
        def predict():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous

            infer_request = self.detectModel.create_infer_request()
            tensor = ov.Tensor(array=im)
            infer_request.set_input_tensor(tensor)
            output_tensors = infer_request.infer()
            ret = output_tensors[0][0]
            return ret

        ret = await asyncio.get_event_loop().run_in_executor(
            faceDetectPredict, lambda: predict()
        )
        return ret

    async def predictFaceModel(self, input: np.ndarray):
        def predict():
            im = ov.Tensor(array=input)
            infer_request = self.faceModel.create_infer_request()
            infer_request.set_input_tensor(im)
            output_tensors = infer_request.infer()
            ret = output_tensors[0]
            return ret

        ret = await asyncio.get_event_loop().run_in_executor(
            faceRecognizePredict, lambda: predict()
        )
        return ret
