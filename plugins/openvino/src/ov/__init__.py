from __future__ import annotations

import asyncio
import concurrent.futures
import os
import re
from typing import Any, Tuple

import openvino.runtime as ov
import scrypted_sdk
from PIL import Image
from scrypted_sdk.other import SettingValue
from scrypted_sdk.types import Setting

from predict import PredictPlugin, Prediction, Rectangle
import numpy as np
import yolo


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
        available_devices = self.core.available_devices
        print('available devices: %s' % available_devices)

        mode = self.storage.getItem('mode')
        if mode == 'Default':
            mode = 'AUTO'
        mode = mode or 'AUTO'

        precision = self.storage.getItem('precision') or 'Default'
        if precision == 'Default':
            using_mode = mode
            if using_mode == 'AUTO':
                if 'GPU' in available_devices:
                    using_mode = 'GPU'
            if using_mode == 'GPU':
                precision = 'FP16'
            else:
                precision = 'FP32'

        
        model = self.storage.getItem('model') or 'Default'
        if model == 'Default':
            model = 'ssd_mobilenet_v1_coco'
        self.yolo = 'yolo' in model
        self.sigmoid = model == 'yolo-v4-tiny-tf'

        print(f'model/mode/precision: {model}/{mode}/{precision}')

        self.model_dim = 416 if self.yolo else 300
        model_version = 'v3'
        xmlFile = self.downloadFile(f'https://raw.githubusercontent.com/koush/openvino-models/main/{model}/{precision}/{model}.xml', f'{model_version}/{precision}/{model}.xml')
        labelsFile = self.downloadFile(f'https://raw.githubusercontent.com/koush/openvino-models/main/{model}/{precision}/{model}.bin', f'{model_version}/{precision}/{model}.bin')

        try:
            self.compiled_model = self.core.compile_model(xmlFile, mode)
        except:
            import traceback
            traceback.print_exc()
            print("Reverting all settings.")
            self.storage.removeItem('mode')
            self.storage.removeItem('model')
            self.storage.removeItem('precision')
            asyncio.run_coroutine_threadsafe(scrypted_sdk.deviceManager.requestRestart(), asyncio.get_event_loop())

        labelsFile = self.downloadFile('https://raw.githubusercontent.com/koush/openvino-models/main/coco_80cl.txt', 'coco_80cl.txt')
        labels_contents = open(labelsFile, 'r').read()
        self.labels = parse_label_contents(labels_contents)

        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="openvino", )

    async def getSettings(self) -> list[Setting]:
        mode = self.storage.getItem('mode') or 'Default'
        model = self.storage.getItem('model') or 'Default'
        precision = self.storage.getItem('precision') or 'Default'
        return [
            {
                'key': 'model',
                'title': 'Model',
                'description': 'The detection model used to find objects.',
                'choices': [
                    'Default',
                    'ssd_mobilenet_v1_coco',
                    'ssdlite_mobilenet_v2',
                    'yolo-v3-tiny-tf',
                    'yolo-v4-tiny-tf',
                ],
                'value': model,
            },
            {
                'key': 'mode',
                'title': 'Mode',
                'description': 'AUTO, CPU, or GPU mode to use for detections. Requires plugin reload. Use CPU if the system has unreliable GPU drivers.',
                'choices': [
                    'Default',
                    'AUTO',
                    'CPU',
                    'GPU',
                ],
                'value': mode,
            },
            {
                'key': 'precision',
                'title': 'Precision',
                'description': 'The model floating point precision. FP16 is recommended for GPU. FP32 is recommended for CPU.',
                'choices': [
                    'Default',
                    'FP16',
                    'FP32',
                ],
                'value': precision,
            }
        ]
    
    async def putSetting(self, key: str, value: SettingValue):
        self.storage.setItem(key, value)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        await scrypted_sdk.deviceManager.requestRestart()

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return [self.model_dim, self.model_dim, 3]

    def get_input_size(self) -> Tuple[int, int]:
        return [self.model_dim, self.model_dim]

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def predict():
            infer_request = self.compiled_model.create_infer_request()
            if self.yolo:
                input_tensor = ov.Tensor(array=np.expand_dims(np.array(input), axis=0).astype(np.float32), shared_memory=True)
            else:
                input_tensor = ov.Tensor(array=np.expand_dims(np.array(input), axis=0), shared_memory=True)
            # Set input tensor for model with one input
            infer_request.set_input_tensor(input_tensor)
            infer_request.start_async()
            infer_request.wait()

            objs = []

            if self.yolo:
                # index 2 will always either be 13 or 26
                # index 1 may be 13/26 or 255 depending on yolo 3 vs 4
                if infer_request.outputs[0].data.shape[2] == 13:
                    out_blob = infer_request.outputs[0]
                else:
                    out_blob = infer_request.outputs[1]
                
                # 13 13
                objects = yolo.parse_yolo_region(out_blob.data, (input.width, input.height),(81,82, 135,169, 344,319), self.sigmoid)

                for r in objects:
                    obj = Prediction(r['classId'], r['confidence'], Rectangle(
                        r['xmin'],
                        r['ymin'],
                        r['xmax'],
                        r['ymax']
                    ))
                    objs.append(obj)

                # what about output[1]?
                # 26 26
                # objects = yolo.parse_yolo_region(out_blob, (input.width, input.height), (,27, 37,58, 81,82))

                return objs


            output = infer_request.get_output_tensor(0)
            for values in output.data[0][0].astype(float):
                valid, index, confidence, l, t, r, b = values
                if valid == -1:
                    break

                def torelative(value: float):
                    return value * self.model_dim

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
