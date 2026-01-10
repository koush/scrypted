from __future__ import annotations

import asyncio
import os

import numpy as np
from PIL import Image

import openvino as ov
from ov import async_infer
from predict.face_recognize import FaceRecognizeDetection

faceDetectPrepare, faceDetectPredict = async_infer.create_executors("FaceDetect")
faceRecognizePrepare, faceRecognizePredict = async_infer.create_executors(
    "FaceRecognize"
)


class OpenVINOFaceRecognition(FaceRecognizeDetection):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def downloadModel(self, model: str):
        inception = "inception" in model
        ovmodel = "best-converted" if not inception else "best"
        if not inception:
            model = model + "_int8"
        model_path = self.downloadHuggingFaceModelLocalFallback(model)
        xmlFile = os.path.join(model_path, f"{ovmodel}.xml")
        if inception:
            model = self.plugin.core.read_model(xmlFile)
            model.reshape([1, 3, 160, 160])
            return self.plugin.core.compile_model(model, self.plugin.mode)
        else:
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
