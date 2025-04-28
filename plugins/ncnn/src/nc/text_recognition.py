from __future__ import annotations

import asyncio

import numpy as np

import ncnn
from nc import async_infer
from predict.text_recognize import TextRecognition

textDetectPrepare, textDetectPredict = async_infer.create_executors("TextDetect")
textRecognizePrepare, textRecognizePredict = async_infer.create_executors(
    "TextRecognize"
)


class NCNNTextRecognition(TextRecognition):
    def downloadModel(self, model: str):
        model_version = "v1"
        files = [
            f"{model}/{model}.ncnn.bin",
            f"{model}/{model}.ncnn.param",
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
        net.opt.use_fp16_packed = False
        net.opt.use_fp16_storage = False
        net.opt.use_fp16_arithmetic = False

        net.load_param(paramFile)
        net.load_model(binFile)

        input_name = net.input_names()[0]

        return [net, input_name]


    async def predictDetectModel(self, input: np.ndarray):
        def prepare():
            # no batch? https://github.com/Tencent/ncnn/issues/5990#issuecomment-2832927105
            im = input.squeeze(0)
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
            output_tensors = output_tensors.transpose((1, 2, 0))
            # readd a batch dimension
            output_tensors = np.expand_dims(output_tensors, axis=0)
            return output_tensors

        input_tensor = await asyncio.get_event_loop().run_in_executor(
            textDetectPrepare, lambda: prepare()
        )
        return await asyncio.get_event_loop().run_in_executor(
            textDetectPredict, lambda: predict(input_tensor)
        )

    async def predictTextModel(self, input: np.ndarray):
        def prepare():
            # no batch? https://github.com/Tencent/ncnn/issues/5990#issuecomment-2832927105
            im = input.squeeze(0)
            im = np.ascontiguousarray(im)  # contiguous
            return im

        def predict(input_tensor):
            net, input_name = self.textModel
            input_ncnn = ncnn.Mat(input_tensor)
            ex = net.create_extractor()
            ex.input(input_name, input_ncnn)

            output_ncnn = ncnn.Mat()
            ex.extract("out0", output_ncnn)

            output_tensors = np.array(output_ncnn)
            # readd a batch dimension
            output_tensors = np.expand_dims(output_tensors, axis=0)
            return output_tensors

        input_tensor = await asyncio.get_event_loop().run_in_executor(
            textRecognizePrepare, lambda: prepare()
        )
        return await asyncio.get_event_loop().run_in_executor(
            textRecognizePredict, lambda: predict(input_tensor)
        )
