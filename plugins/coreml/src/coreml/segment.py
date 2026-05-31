from __future__ import annotations

import asyncio
import os
import traceback

import numpy as np

import coremltools as ct
from common import async_infer
from common import yolov9_seg
from predict.segment import Segmentation

prepareExecutor, predictExecutor = async_infer.create_executors("Segment")


class CoreMLSegmentation(Segmentation):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def loadModel(self, name):
        model_path = self.plugin.downloadHuggingFaceModelLocalFallback(name)
        modelFile = os.path.join(model_path, f"{name}.mlpackage")
        model = ct.models.MLModel(modelFile)
        return model

    async def detect_once(self, input, settings, src_size, cvss):
        def predict():
            input_name = self.model.get_spec().description.input[0].name
            out_dict = self.model.predict({input_name: input})

            outputs = list(out_dict.values())
            pred = outputs[0]
            proto = outputs[1]
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
