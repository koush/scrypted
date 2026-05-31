from __future__ import annotations

import asyncio
import os
import traceback

import numpy as np

import onnxruntime
from predict.segment import Segmentation
from common import yolov9_seg
from common import async_infer

prepareExecutor, predictExecutor = async_infer.create_executors("Segment")



class ONNXSegmentation(Segmentation):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def loadModel(self, name):
        model_path = self.plugin.downloadHuggingFaceModelLocalFallback(name)
        onnxfile = os.path.join(model_path, f"{name}.onnx")
        model = onnxruntime.InferenceSession(onnxfile)
        return model

    async def detect_once(self, input, settings, src_size, cvss):
        def prepare():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous
            return im

        def predict():
            input_tensor = prepare()
            output_tensors = self.model.run(None, {self.input_name: input_tensor})

            pred = output_tensors[0]
            proto = output_tensors[1]
            pred = yolov9_seg.non_max_suppression(pred, nm=32)

            return self.process_segmentation_output(pred, proto)

        try:
            objs = await asyncio.get_event_loop().run_in_executor(
                predictExecutor, lambda: predict()
            )
        except:
            traceback.print_exc()
            raise

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
