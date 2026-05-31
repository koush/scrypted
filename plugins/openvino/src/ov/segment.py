from __future__ import annotations

import asyncio
import os
import traceback

import numpy as np

import openvino as ov
from predict.segment import Segmentation
from common import yolov9_seg
from common import async_infer

prepareExecutor, predictExecutor = async_infer.create_executors("Segment")



class OpenVINOSegmentation(Segmentation):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def loadModel(self, name):
        name = name + "_int8"
        model_path = self.downloadHuggingFaceModelLocalFallback(name)
        ovmodel = "best-converted"
        xmlFile = os.path.join(model_path, f"{ovmodel}.xml")
        model = self.plugin.core.compile_model(xmlFile, self.plugin.mode)
        return model

    async def detect_once(self, input, settings, src_size, cvss):
        def predict():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous

            infer_request = self.model.create_infer_request()
            tensor = ov.Tensor(array=im)
            infer_request.set_input_tensor(tensor)
            output_tensors = infer_request.infer()

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

