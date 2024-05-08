from __future__ import annotations

import ast
import asyncio
import concurrent.futures
import json
import platform
import sys
import threading
import traceback
from typing import Any, Tuple

import numpy as np
import onnxruntime
import scrypted_sdk
from PIL import Image
from scrypted_sdk.other import SettingValue
from scrypted_sdk.types import Setting

import common.yolo as yolo
from predict import PredictPlugin

availableModels = [
    "Default",
    "scrypted_yolov6n_320",
    "scrypted_yolov6n",
    "scrypted_yolov6s_320",
    "scrypted_yolov6s",
    "scrypted_yolov9c_320",
    "scrypted_yolov9c",
    "scrypted_yolov8n_320",
    "scrypted_yolov8n",
]

def parse_labels(names):
    j = ast.literal_eval(names)
    ret = {}
    for k, v in j.items():
        ret[int(k)] = v
    return ret

class ONNXPlugin(
    PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings, scrypted_sdk.DeviceProvider
):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        model = self.storage.getItem("model") or "Default"
        if model == "Default" or model not in availableModels:
            if model != "Default":
                self.storage.setItem("model", "Default")
            model = "scrypted_yolov8n_320"
        self.yolo = "yolo" in model
        self.scrypted_yolo = "scrypted_yolo" in model
        self.scrypted_model = "scrypted" in model

        print(f"model {model}")

        onnxmodel = "best" if self.scrypted_model else model

        model_version = "v2"
        onnxfile = self.downloadFile(
            f"https://raw.githubusercontent.com/koush/onnx-models/main/{model}/{onnxmodel}.onnx",
            f"{model_version}/{model}/{onnxmodel}.onnx",
        )

        print(onnxfile)

        deviceIds = self.storage.getItem("deviceIds") or '["0"]'
        deviceIds = json.loads(deviceIds)
        if not len(deviceIds):
            deviceIds = ["0"]

        compiled_models = []
        self.compiled_models = {}

        try:
            for deviceId in deviceIds:
                sess_options = onnxruntime.SessionOptions()

                providers: list[str] = []
                if sys.platform == 'darwin':
                    providers.append("CoreMLExecutionProvider")

                if 'linux' in sys.platform and platform.machine() == 'x86_64':
                    deviceId = int(deviceId)
                    providers.append(("CUDAExecutionProvider", { "device_id": deviceId }))

                providers.append('CPUExecutionProvider')

                compiled_model = onnxruntime.InferenceSession(onnxfile, sess_options=sess_options, providers=providers)
                compiled_models.append(compiled_model)

                input = compiled_model.get_inputs()[0]
                self.model_dim = input.shape[2]
                self.input_name = input.name
                self.labels = parse_labels(compiled_model.get_modelmeta().custom_metadata_map['names'])

        except:
            import traceback

            traceback.print_exc()
            print("Reverting all settings.")
            self.storage.removeItem("model")
            self.storage.removeItem("deviceIds")
            self.requestRestart()

        def executor_initializer():
            thread_name = threading.current_thread().name
            interpreter = compiled_models.pop()
            self.compiled_models[thread_name] = interpreter
            print('Runtime initialized on thread {}'.format(thread_name))

        self.executor = concurrent.futures.ThreadPoolExecutor(
            initializer=executor_initializer,
            max_workers=len(compiled_models),
            thread_name_prefix="onnx",
        )

        self.prepareExecutor = concurrent.futures.ThreadPoolExecutor(
            max_workers=len(compiled_models),
            thread_name_prefix="onnx-prepare",
        )

    async def getSettings(self) -> list[Setting]:
        model = self.storage.getItem("model") or "Default"
        deviceIds = self.storage.getItem("deviceIds") or '["0"]'
        deviceIds = json.loads(deviceIds)

        return [
            {
                "key": "model",
                "title": "Model",
                "description": "The detection model used to find objects.",
                "choices": availableModels,
                "value": model,
            },
            {
                "key": "deviceIds",
                "title": "Device IDs",
                "description": "Optional: Assign multiple CUDA Device IDs to use for detection.",
                "choices": deviceIds,
                "combobox": True,
                "multiple": True,
                "value": deviceIds,
            },
        ]

    async def putSetting(self, key: str, value: SettingValue):
        if (key == 'deviceIds'):
            value = json.dumps(value)
        self.storage.setItem(key, value)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        self.requestRestart()

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return [self.model_dim, self.model_dim, 3]

    def get_input_size(self) -> Tuple[int, int]:
        return [self.model_dim, self.model_dim]

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def prepare(): 
            im = np.array(input)
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous
            return im

        def predict(input_tensor):
            compiled_model = self.compiled_models[threading.current_thread().name]
            output_tensors = compiled_model.run(None, { self.input_name: input_tensor })
            objs = yolo.parse_yolov9(output_tensors[0][0])
            return objs

        try:
            input_tensor = await asyncio.get_event_loop().run_in_executor(
                self.prepareExecutor, lambda: prepare()
            )
            objs = await asyncio.get_event_loop().run_in_executor(
                self.executor, lambda: predict(input_tensor)
            )

        except:

            traceback.print_exc()
            raise

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
