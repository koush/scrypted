from __future__ import annotations

import asyncio
import concurrent.futures
import platform
import sys
import threading

import numpy as np
import onnxruntime
from PIL import Image

from predict.text_recognize import TextRecognition


class ONNXTextRecognition(TextRecognition):
    def downloadModel(self, model: str):
        onnxmodel = model
        model_version = "v4"
        onnxfile = self.downloadFile(
            f"https://github.com/koush/onnx-models/raw/main/{model}/{onnxmodel}.onnx",
            f"{model_version}/{model}/{onnxmodel}.onnx",
        )
        print(onnxfile)

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
                onnxfile, sess_options=sess_options, providers=providers
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
            thread_name_prefix="text",
        )

        prepareExecutor = concurrent.futures.ThreadPoolExecutor(
            max_workers=len(compiled_models_array),
            thread_name_prefix="text-prepare",
        )

        return compiled_models, input_name, prepareExecutor, executor

    async def predictDetectModel(self, input: Image.Image):
        compiled_models, input_name, prepareExecutor, executor = self.detectModel

        def predict():
            compiled_model = compiled_models[threading.current_thread().name]
            output_tensors = compiled_model.run(None, {input_name: input})
            return output_tensors

        objs = await asyncio.get_event_loop().run_in_executor(
            executor, lambda: predict()
        )

        return objs[0]

    async def predictTextModel(self, input: np.ndarray):
        input = input.astype(np.float32)
        compiled_models, input_name, prepareExecutor, executor = self.textModel

        def predict():
            compiled_model = compiled_models[threading.current_thread().name]
            output_tensors = compiled_model.run(None, {input_name: input})
            return output_tensors

        objs = await asyncio.get_event_loop().run_in_executor(
            executor, lambda: predict()
        )

        return objs[0]
