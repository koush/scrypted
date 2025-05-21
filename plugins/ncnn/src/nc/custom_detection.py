from __future__ import annotations

import asyncio

import numpy as np
from PIL import Image
import os
import ncnn

from predict.custom_detect import CustomDetection
from scrypted_sdk import ObjectsDetected
import concurrent.futures


class NCNNCustomDetection(CustomDetection):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)
        self.prefer_relu = True
        self.detectExecutor = concurrent.futures.ThreadPoolExecutor(1, "detect-custom")
        self.prepareExecutor = concurrent.futures.ThreadPoolExecutor(1, "prepare-custom")

    def loadModel(self, files: list[str]):
        # find the xml file in the files list
        bin_files = [f for f in files if f.lower().endswith('.bin')]
        if not bin_files:
            raise ValueError("No bkin file found in the provided files list")
        bin_file = bin_files[0]
        param_files = [f for f in files if f.lower().endswith('.param')]
        if not param_files:
            raise ValueError("No param file found in the provided files list")
        param_file = param_files[0]

        net = ncnn.Net()
        net.opt.use_vulkan_compute = True
        # net.opt.use_fp16_packed = False
        # net.opt.use_fp16_storage = False
        # net.opt.use_fp16_arithmetic = False

        net.load_param(param_file)
        net.load_model(bin_file)

        input_name = net.input_names()[0]

        return net, input_name
        
    async def predictModel(self, input: Image.Image) -> ObjectsDetected:
        def prepare():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0

            if self.model_config.get("mean", None) and self.model_config.get("std", None):
                mean = np.array(self.model_config["mean"])
                std = np.array(self.model_config["std"])
                mean = mean.reshape(1, -1, 1, 1)
                std = std.reshape(1, -1, 1, 1)
                im = (im - mean) / std
                im = im.astype(np.float32)

            # no batch? https://github.com/Tencent/ncnn/issues/5990#issuecomment-2832927105
            im = im.squeeze(0)
            im = np.ascontiguousarray(im)  # contiguous
            return im

        def predict(input_tensor):
            net, input_name = self.model
            input_ncnn = ncnn.Mat(input_tensor)
            ex = net.create_extractor()
            ex.input(input_name, input_ncnn)

            output_ncnn = ncnn.Mat()
            ex.extract("out0", output_ncnn)

            output_tensors = np.array(output_ncnn)
            return output_tensors

        input_tensor = await asyncio.get_event_loop().run_in_executor(
            self.prepareExecutor, lambda: prepare()
        )
        return await asyncio.get_event_loop().run_in_executor(
            self.detectExecutor, lambda: predict(input_tensor)
        )
