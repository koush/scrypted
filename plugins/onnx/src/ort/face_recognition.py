from __future__ import annotations

import asyncio
import concurrent.futures
import platform
import sys
import threading

import numpy as np
import onnxruntime
from PIL import Image

from predict.face_recognize import FaceRecognizeDetection


class ONNXFaceRecognition(FaceRecognizeDetection):
    def downloadModel(self, model: str):
        onnxmodel = "best" if "scrypted" in model else model
        model_version = "v1"
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
            thread_name_prefix="face",
        )

        prepareExecutor = concurrent.futures.ThreadPoolExecutor(
            max_workers=len(compiled_models_array),
            thread_name_prefix="face-prepare",
        )

        return compiled_models, input_name, prepareExecutor, executor

    async def predictDetectModel(self, input: Image.Image):
        compiled_models, input_name, prepareExecutor, executor = self.detectModel

        def prepare():
            im = np.array(input)
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous
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

    async def predictFaceModel(self, input: np.ndarray):
        compiled_models, input_name, prepareExecutor, executor = self.faceModel

        def predict():
            compiled_model = compiled_models[threading.current_thread().name]
            output_tensors = compiled_model.run(None, {input_name: input})
            return output_tensors

        objs = await asyncio.get_event_loop().run_in_executor(
            executor, lambda: predict()
        )

        return objs[0]
