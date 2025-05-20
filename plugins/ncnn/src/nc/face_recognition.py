from __future__ import annotations

import asyncio

import numpy as np
from PIL import Image

import ncnn
from nc import async_infer
from predict.face_recognize import FaceRecognizeDetection

faceDetectPrepare, faceDetectPredict = async_infer.create_executors("FaceDetect")
faceRecognizePrepare, faceRecognizePredict = async_infer.create_executors(
    "FaceRecognize"
)


class NCNNFaceRecognition(FaceRecognizeDetection):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)
        self.prefer_relu = True

    def downloadModel(self, model: str):
        scrypted_yolov9 = "scrypted_yolov9" in model
        ncnnmodel = "best_converted" if scrypted_yolov9 else model
        model_version = "v1"
        files = [
            f"{model}/{ncnnmodel}.ncnn.bin",
            f"{model}/{ncnnmodel}.ncnn.param",
        ]

        for f in files:
            p = self.downloadFile(
                f"https://github.com/koush/ncnn-models/raw/main/{f}",
                f"{model_version}/{f}",
            )
            if ".bin" in p:
                binFile = p
            if ".param" in p:
                paramFile = p


        net = ncnn.Net()
        net.opt.use_vulkan_compute = True
        # net.opt.use_fp16_packed = False
        # net.opt.use_fp16_storage = False
        # net.opt.use_fp16_arithmetic = False

        net.load_param(paramFile)
        net.load_model(binFile)

        input_name = net.input_names()[0]

        return [net, input_name]

    async def predictDetectModel(self, input: Image.Image):
        def prepare():
            im = np.array(input)
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            # no batch? https://github.com/Tencent/ncnn/issues/5990#issuecomment-2832927105
            im = im.reshape((1, 3, 320, 320)).squeeze(0)
            im = np.ascontiguousarray(im)  # contiguous
            return im

        def predict(input_tensor):
            net, input_name = self.detectModel
            input_ncnn = ncnn.Mat(input_tensor)
            ex = net.create_extractor()
            ex.input(input_name, input_ncnn)

            output_ncnn = ncnn.Mat()
            ex.extract("out0", output_ncnn)

            output_tensors = np.array(output_ncnn)
            return output_tensors

        input_tensor = await asyncio.get_event_loop().run_in_executor(
            faceDetectPrepare, lambda: prepare()
        )
        return await asyncio.get_event_loop().run_in_executor(
            faceDetectPredict, lambda: predict(input_tensor)
        )


    async def predictFaceModel(self, input: np.ndarray):
        def prepare():
            # no batch? https://github.com/Tencent/ncnn/issues/5990#issuecomment-2832927105
            im = input.squeeze(0)
            im = np.ascontiguousarray(im)  # contiguous
            return im

        def predict(input_tensor):
            net, input_name = self.faceModel
            input_ncnn = ncnn.Mat(input_tensor)
            ex = net.create_extractor()
            ex.input(input_name, input_ncnn)

            output_ncnn = ncnn.Mat()
            ex.extract("out0", output_ncnn)

            output_tensors = np.array(output_ncnn)
            return output_tensors

        input_tensor = await asyncio.get_event_loop().run_in_executor(
            faceDetectPrepare, lambda: prepare()
        )
        return await asyncio.get_event_loop().run_in_executor(
            faceDetectPredict, lambda: predict(input_tensor)
        )
