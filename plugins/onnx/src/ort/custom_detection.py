from __future__ import annotations

import asyncio

import numpy as np
from PIL import Image
import onnxruntime
import sys
import threading
import platform

from predict.custom_detect import CustomDetection
from scrypted_sdk import ObjectsDetected
import concurrent.futures


class ONNXCustomDetection(CustomDetection):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)
        self.prefer_relu = True
        self.detectExecutor = concurrent.futures.ThreadPoolExecutor(1, "detect-custom")

    def loadModel(self, files: list[str]):
        # find the xml file in the files list
        onnx_files = [f for f in files if f.lower().endswith('.onnx')]
        if not onnx_files:
            raise ValueError("No Manifest.json file found in the provided files list")
        onnx_file = onnx_files[0]

        compiled_models_array = []
        compiled_models = {}
        deviceIds = self.plugin.deviceIds

        for deviceId in deviceIds:
            sess_options = onnxruntime.SessionOptions()

            providers: list[str] = []
            if sys.platform == "darwin":
                providers.append("CoreMLExecutionProvider")

            if "linux" in sys.platform and platform.machine() == "x86_64":
                deviceId = int(deviceId)
                providers.append(("CUDAExecutionProvider", {"device_id": deviceId}))

            providers.append("CPUExecutionProvider")

            compiled_model = onnxruntime.InferenceSession(
                onnx_file, sess_options=sess_options, providers=providers
            )
            compiled_models_array.append(compiled_model)

            input = compiled_model.get_inputs()[0]
            input_name = input.name

        def executor_initializer():
            thread_name = threading.current_thread().name
            interpreter = compiled_models_array.pop()
            compiled_models[thread_name] = interpreter
            print("Runtime initialized on thread {}".format(thread_name))

        executor = concurrent.futures.ThreadPoolExecutor(
            initializer=executor_initializer,
            max_workers=len(compiled_models_array),
            thread_name_prefix="custom",
        )

        prepareExecutor = concurrent.futures.ThreadPoolExecutor(
            max_workers=len(compiled_models_array),
            thread_name_prefix="custom-prepare",
        )

        return compiled_models, input_name, prepareExecutor, executor


    async def predictModel(self, input: Image.Image) -> ObjectsDetected:
        compiled_models, input_name, prepareExecutor, executor = self.model
        def predict():
            if self.model_config.get("mean", None) and self.model_config.get("std", None):
                im = np.expand_dims(input, axis=0)
                im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
                im = im.astype(np.float32) / 255.0

                mean = np.array(self.model_config["mean"])
                std = np.array(self.model_config["std"])
                mean = mean.reshape(1, -1, 1, 1)
                std = std.reshape(1, -1, 1, 1)
                im = (im - mean) / std

                im = np.ascontiguousarray(im.astype(np.float32))  # contiguous

                out_dict = model.predict({inputName: im})
            else:
                out_dict = self.model.predict({self.inputName: input})

            results = list(out_dict.values())[0][0]
            return results

        def prepare():
            im = np.array(input)
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

            im = np.ascontiguousarray(im)
            return im

        def predict(input_tensor):
            compiled_model = compiled_models[threading.current_thread().name]
            output_tensors = compiled_model.run(None, {input_name: input_tensor})
            return output_tensors

        input_tensor = await asyncio.get_event_loop().run_in_executor(
            prepareExecutor, lambda: prepare()
        )
        objs = await asyncio.get_event_loop().run_in_executor(
            executor, lambda: predict(input_tensor)
        )

        return objs[0][0]
