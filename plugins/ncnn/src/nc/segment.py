from __future__ import annotations

import asyncio
import os
import traceback

import numpy as np

import ncnn
from nc import async_infer
from common import yolov9_seg
from predict.segment import Segmentation

prepareExecutor, predictExecutor = async_infer.create_executors("NCNN-Segment")


class NCNNSegmentation(Segmentation):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def loadModel(self, name):
        model_path = self.downloadHuggingFaceModelLocalFallback(name)
        model_name = 'best_converted'
        binFile = os.path.join(model_path, f"{model_name}.ncnn.bin")
        paramFile = os.path.join(model_path, f"{model_name}.ncnn.param")

        net = ncnn.Net()
        net.opt.use_vulkan_compute = True

        net.load_param(paramFile)
        net.load_model(binFile)

        input_name = net.input_names()[0]

        return [net, input_name]

    async def detect_once(self, input, settings, src_size, cvss):
        def prepare():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW
            im = im.astype(np.float32) / 255.0
            im = im.reshape((1, 3, 320, 320)).squeeze(0)
            im = np.ascontiguousarray(im)
            return im

        def predict(input_tensor):
            net, input_name = self.model
            input_ncnn = ncnn.Mat(input_tensor)
            ex = net.create_extractor()
            ex.input(input_name, input_ncnn)

            out0 = ncnn.Mat()
            out1 = ncnn.Mat()
            ex.extract("out0", out0)
            ex.extract("out1", out1)

            # ncnn does not have batch dimension, so unsqueeze
            pred = np.array([out0])
            proto = np.array([out1])
            pred = yolov9_seg.non_max_suppression(pred, nm=32)

            return self.process_segmentation_output(pred, proto)

        try:
            input_tensor = await asyncio.get_event_loop().run_in_executor(
                prepareExecutor, lambda: prepare()
            )
            objs = await asyncio.get_event_loop().run_in_executor(
                predictExecutor, lambda: predict(input_tensor)
            )
        except:
            traceback.print_exc()
            raise

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
