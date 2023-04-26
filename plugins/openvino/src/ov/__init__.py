from __future__ import annotations

import asyncio
import concurrent.futures
import os
import re
from typing import Any, Tuple

import openvino.runtime as ov
import scrypted_sdk
from PIL import Image
from scrypted_sdk.types import Setting

from predict import PredictPlugin, Prediction, Rectangle
import numpy as np


def parse_label_contents(contents: str):
    lines = contents.splitlines()
    ret = {}
    for row_number, content in enumerate(lines):
        pair = re.split(r'[:\s]+', content.strip(), maxsplit=1)
        if len(pair) == 2 and pair[0].strip().isdigit():
            ret[int(pair[0])] = pair[1].strip()
        else:
            ret[row_number] = content.strip()
    return ret


class OpenVINOPlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        self.core = ov.Core()

        xmlFile = self.downloadFile('https://raw.githubusercontent.com/koush/openvino-models/main/ssd_mobilenet_v1_coco/FP16/ssd_mobilenet_v1_coco.xml', 'ssd_mobilenet_v1_coco.xml')
        mappingFile = self.downloadFile('https://raw.githubusercontent.com/koush/openvino-models/main/ssd_mobilenet_v1_coco/FP16/ssd_mobilenet_v1_coco.mapping', 'ssd_mobilenet_v1_coco.mapping')
        labelsFile = self.downloadFile('https://raw.githubusercontent.com/koush/openvino-models/main/ssd_mobilenet_v1_coco/FP16/ssd_mobilenet_v1_coco.bin', 'ssd_mobilenet_v1_coco.bin')

        self.compiled_model = self.core.compile_model(xmlFile, "AUTO")

        labelsFile = self.downloadFile('https://raw.githubusercontent.com/google-coral/test_data/master/coco_labels.txt', 'coco_labels.txt')
        labels_contents = open(labelsFile, 'r').read()
        self.labels = parse_label_contents(labels_contents)

        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="openvino", )

    async def getSettings(self) -> list[Setting]:
        return []

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return [300, 300, 3]

    def get_input_size(self) -> Tuple[int, int]:
        return [300, 300]

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def predict():
            infer_request = self.compiled_model.create_infer_request()
            input_tensor = ov.Tensor(array=np.expand_dims(np.array(input), axis=0), shared_memory=True)
            # Set input tensor for model with one input
            infer_request.set_input_tensor(input_tensor)
            infer_request.start_async()
            infer_request.wait()
            output = infer_request.get_output_tensor()

            objs = []
            for values in output.data[0][0].astype(float):
                valid, index, confidence, l, t, r, b = values
                if valid == -1:
                    break

                def torelative(value: float):
                    return value * 300

                l = torelative(l)
                t = torelative(t)
                r = torelative(r)
                b = torelative(b)

                obj = Prediction(index - 1, confidence, Rectangle(
                    l,
                    t,
                    r,
                    b
                ))
                objs.append(obj)

            return objs

        try:
            objs = await asyncio.get_event_loop().run_in_executor(self.executor, predict)
        except:
            import traceback
            traceback.print_exc()
            raise

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
