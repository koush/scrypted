from __future__ import annotations

import json
import threading

from PIL import Image

from .tflite_common import *

from tflite_support.task import vision, core, processor

import asyncio
import concurrent.futures
import re
from typing import Any, Tuple

import scrypted_sdk
from ai_edge_litert.interpreter import Interpreter
from .yolo_separate_outputs import *
from scrypted_sdk.types import Setting, SettingValue

from common import yolo
from predict import PredictPlugin

prepareExecutor = concurrent.futures.ThreadPoolExecutor(thread_name_prefix="TFLite-Prepare")

availableModels = [
    "Default",
    "scrypted_yolov9s_relu_sep_320",
    "scrypted_yolov9t_relu_320",
    "scrypted_yolov9s_relu_320",
    "ssd_mobilenet_v2_coco_quant_postprocess",
    "tf2_ssd_mobilenet_v2_coco17_ptq",
    "ssdlite_mobiledet_coco_qat_postprocess",
    "scrypted_yolov10n_320",
    "scrypted_yolov10s_320",
    "scrypted_yolov10m_320",
    "scrypted_yolov6n_320",
    "scrypted_yolov6s_320",
    "scrypted_yolov9c_320",
    "scrypted_yolov8n_320",
    "efficientdet_lite0_320_ptq",
    "efficientdet_lite1_384_ptq",
    "efficientdet_lite2_448_ptq",
    "efficientdet_lite3_512_ptq",
    "efficientdet_lite3x_640_ptq",
]


def parse_label_contents(contents: str):
    lines = contents.splitlines()
    lines = [line for line in lines if line.strip()]
    ret = {}
    for row_number, content in enumerate(lines):
        pair = re.split(r"[:\s]+", content.strip(), maxsplit=1)
        if len(pair) == 2 and pair[0].strip().isdigit():
            ret[int(pair[0])] = pair[1].strip()
        else:
            ret[row_number] = content.strip()
    return ret


class TensorFlowLitePlugin(
    PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings
):
    def __init__(self, nativeId: str | None = None, forked: bool = False):
        super().__init__(nativeId=nativeId, forked=forked)

        model_version = "v14"
        model = self.storage.getItem("model") or "Default"
        if model not in availableModels:
            self.storage.setItem("model", "Default")
            model = "Default"
        defaultModel = model == "Default"
        branch = "main"
        suffix = ""

        labelsFile = None

        def configureModel():
            nonlocal labelsFile
            nonlocal model

            if defaultModel:
                model = "scrypted_yolov9s_relu_sep_320"
            self.yolo = "yolo" in model
            self.yolov9 = "yolov9" in model
            self.scrypted_model = "scrypted" in model
            self.scrypted_yolov10 = "scrypted_yolov10" in model
            self.scrypted_yolo_sep = "_sep" in model
            self.modelName = model

            print(f"model: {model}")

            if self.scrypted_model:
                labelsFile = self.downloadFile(
                    f"https://raw.githubusercontent.com/koush/tflite-models/{branch}/scrypted_labels.txt",
                    f"{model_version}/scrypted_labels.txt",
                )
            elif self.yolo:
                labelsFile = self.downloadFile(
                    f"https://raw.githubusercontent.com/koush/tflite-models/{branch}/coco_80cl.txt",
                    f"{model_version}/coco_80cl.txt",
                )
            else:
                labelsFile = self.downloadFile(
                    f"https://raw.githubusercontent.com/koush/tflite-models/{branch}/coco_labels.txt",
                    f"{model_version}/coco_labels.txt",
                )

            labels_contents = open(labelsFile, "r").read()
            self.labels = parse_label_contents(labels_contents)

        self.interpreters = {}
        available_interpreters = []
        self.interpreter_count = 0

        def downloadModel():
            tflite_model = "best_full_integer_quant" if self.scrypted_model else model
            return self.downloadFile(
                f"https://github.com/koush/tflite-models/raw/{branch}/{model}/{tflite_model}{suffix}.tflite",
                f"{model_version}/{model}/{tflite_model}{suffix}.tflite",
            )

        configureModel()
        modelFile = downloadModel()
        interpreter = Interpreter(model_path=modelFile)
        interpreter.allocate_tensors()
        self.image_input_details = interpreter.get_input_details()[0]
        _, height, width, channels = self.image_input_details["shape"]
        self.input_details = int(width), int(height), int(channels)
        available_interpreters.append(interpreter)
        self.interpreter_count = self.interpreter_count + 1

        print(modelFile, labelsFile)

        def executor_initializer():
            thread_name = threading.current_thread().name
            interpreter = available_interpreters.pop()
            self.interpreters[thread_name] = interpreter
            print("Interpreter initialized on thread {}".format(thread_name))

        self.executor = concurrent.futures.ThreadPoolExecutor(
            initializer=executor_initializer,
            max_workers=self.interpreter_count,
            thread_name_prefix="tflite",
        )

    async def putSetting(self, key: str, value: SettingValue):
        self.storage.setItem(key, value)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        await scrypted_sdk.deviceManager.requestRestart()

    async def getSettings(self) -> list[Setting]:
        model = self.storage.getItem("model") or "Default"
        return [
            {
                "key": "model",
                "title": "Model",
                "description": "The detection model used to find objects.",
                "choices": availableModels,
                "value": model,
            },
        ]

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return self.input_details

    def get_input_size(self) -> Tuple[int, int]:
        return self.input_details[0:2]

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def prepare():
            if not self.yolo:
                return input

            im = np.stack([input])
            # this non-quantized code path is unused but here for reference.
            if self.image_input_details["dtype"] != np.int8 and self.image_input_details["dtype"] != np.int16:
                im = im.astype(np.float32) / 255.0
                return im

            scale, zero_point = self.image_input_details["quantization"]
            if scale == 0.003986024297773838 and zero_point == -128:
                # fast path for quantization 1/255 = 0.003986024297773838
                im = im.view(np.int8)
                im -= 128
            else:
                im = im.astype(np.float32) / (255.0 * scale)
                im = (im + zero_point).astype(np.int8)  # de-scale

            return im

        def predict(im):
            interpreter = self.interpreters[threading.current_thread().name]
            if not self.yolo:
                tflite_common.set_input(interpreter, im)
                interpreter.invoke()
                detector = vision.ObjectDetector.create_from_file(interpreter.model_path)

                objs = detector.detect(im)
                return objs

            tensor_index = input_details(interpreter, "index")
            interpreter.set_tensor(tensor_index, im)
            interpreter.invoke()
            output_details = interpreter.get_output_details()
            output_tensors = [(interpreter.get_tensor(output["index"]), output) for output in output_details]

            return output_tensors

        def post_process(output_tensors):
            if not self.yolo:
                return output_tensors

            # handle separate outputs for quantization accuracy
            if self.scrypted_yolo_sep:
                outputs = []
                for ot, output in output_tensors:
                    o = ot.astype(np.float32)
                    scale, zero_point = output["quantization"]
                    o -= zero_point
                    o *= scale
                    outputs.append(o)

                output = yolo_separate_outputs.decode_bbox(outputs, [input.width, input.height])
                if self.scrypted_yolov10:
                    objs = yolo.parse_yolov10(output[0])
                else:
                    objs = yolo.parse_yolov9(output[0])
                return objs

            # this scale stuff can probably be optimized to dequantize ahead of time...
            x, output = output_tensors[0]
            input_scale = self.get_input_details()[0]

            # this non-quantized code path is unused but here for reference.
            if x.dtype != np.int8 and x.dtype != np.int16:
                if self.scrypted_yolov10:
                    objs = yolo.parse_yolov10(x[0], scale=lambda v: v * input_scale)
                else:
                    objs = yolo.parse_yolov9(x[0], scale=lambda v: v * input_scale)
                return objs

            # this scale stuff can probably be optimized to dequantize ahead of time...
            scale, zero_point = output["quantization"]
            combined_scale = scale * input_scale
            if self.scrypted_yolov10:
                objs = yolo.parse_yolov10(
                    x[0],
                    scale=lambda v: (v - zero_point) * combined_scale,
                    confidence_scale=lambda v: (v - zero_point) * scale,
                    threshold_scale=lambda v: (v - zero_point) * scale,
                )
            else:
                objs = yolo.parse_yolov9(
                    x[0],
                    scale=lambda v: (v - zero_point) * combined_scale,
                    confidence_scale=lambda v: (v - zero_point) * scale,
                    threshold_scale=lambda v: (v - zero_point) * scale,
                )
            return objs


        im = await asyncio.get_event_loop().run_in_executor(prepareExecutor, prepare)
        output_tensors = await asyncio.get_event_loop().run_in_executor(self.executor, lambda: predict(im))
        objs = await asyncio.get_event_loop().run_in_executor(prepareExecutor, lambda: post_process(output_tensors))

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
