from __future__ import annotations

import json
import threading

from PIL import Image
from pycoral.adapters import detect

from .tflite_common import *

loaded_py_coral = False
try:
    from pycoral.utils.edgetpu import list_edge_tpus, make_interpreter

    loaded_py_coral = True
    print("coral edge tpu library loaded successfully")
except Exception as e:
    print("coral edge tpu library load failed", e)
    pass
import asyncio
import concurrent.futures
import queue
import re
from typing import Any, Tuple

import scrypted_sdk
import tflite_runtime.interpreter as tflite
from scrypted_sdk.types import Setting, SettingValue

from common import yolo
from predict import PredictPlugin

availableModels = [
    "Default",
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
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        edge_tpus = None
        try:
            edge_tpus = list_edge_tpus()
            print("edge tpus", edge_tpus)
            if not len(edge_tpus):
                raise Exception("no edge tpu found")
        except Exception as e:
            print("unable to use Coral Edge TPU", e)
            edge_tpus = None
            pass

        model_version = "v13"
        model = self.storage.getItem("model") or "Default"
        if model not in availableModels:
            self.storage.setItem("model", "Default")
            model = "Default"
        defaultModel = model == "Default"
        branch = "main"

        labelsFile = None

        def configureModel():
            nonlocal labelsFile
            nonlocal model

            if defaultModel:
                model = "scrypted_yolov10n_320"
                # if edge_tpus and next(
                #     (obj for obj in edge_tpus if obj["type"] == "usb"), None
                # ):
                #     model = "ssdlite_mobiledet_coco_qat_postprocess"
                # else:
                #     model = "efficientdet_lite0_320_ptq"
            self.yolo = "yolo" in model
            self.yolov9 = "yolov9" in model
            self.scrypted_model = "scrypted" in model
            self.scrypted_yolov10 = "scrypted_yolov10" in model
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

        try:
            if edge_tpus:
                configureModel()
                suffix = "_edgetpu"
                modelFile = downloadModel()
                self.edge_tpu_found = json.dumps(edge_tpus)
                for idx, edge_tpu in enumerate(edge_tpus):
                    try:
                        interpreter = make_interpreter(modelFile, ":%s" % idx)
                        interpreter.allocate_tensors()
                        _, height, width, channels = interpreter.get_input_details()[0][
                            "shape"
                        ]
                        self.input_details = int(width), int(height), int(channels)
                        available_interpreters.append(interpreter)
                        self.interpreter_count = self.interpreter_count + 1
                        print("added tpu %s" % (edge_tpu))
                    except Exception as e:
                        print("unable to use Coral Edge TPU", e)

                if not self.interpreter_count:
                    raise Exception("all tpus failed to load")
            else:
                raise Exception()
        except Exception as e:
            edge_tpus = None
            self.edge_tpu_found = "Edge TPU not found"
            suffix = ""
            configureModel()
            modelFile = downloadModel()
            interpreter = tflite.Interpreter(model_path=modelFile)
            interpreter.allocate_tensors()
            _, height, width, channels = interpreter.get_input_details()[0]["shape"]
            self.input_details = int(width), int(height), int(channels)
            available_interpreters.append(interpreter)
            self.interpreter_count = self.interpreter_count + 1

        print(modelFile, labelsFile)

        def executor_initializer():
            thread_name = threading.current_thread().name
            interpreter = available_interpreters.pop()
            self.interpreters[thread_name] = interpreter
            print('Interpreter initialized on thread {}'.format(thread_name))


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
                "title": "Detected Edge TPU",
                "description": "The device paths of the Coral Edge TPUs that will be used for detections.",
                "value": self.edge_tpu_found,
                "readonly": True,
                "key": "coral",
            },
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
        def predict():
            interpreter = self.interpreters[threading.current_thread().name]
            if self.yolo:
                tensor_index = input_details(interpreter, "index")

                im = np.stack([input])
                i = interpreter.get_input_details()[0]
                if i["dtype"] == np.int8:
                    scale, zero_point = i["quantization"]
                    if scale == 0.003986024297773838 and zero_point == -128:
                        # fast path for quantization 1/255 = 0.003986024297773838
                        im = im.view(np.int8)
                        im -= 128
                    else:
                        im = im.astype(np.float32) / (255.0 * scale)
                        im = (im + zero_point).astype(np.int8)  # de-scale
                else:
                    # this code path is unused.
                    im = im.astype(np.float32) / 255.0
                interpreter.set_tensor(tensor_index, im)
                interpreter.invoke()
                output_details = interpreter.get_output_details()
                output = output_details[0]
                x = interpreter.get_tensor(output["index"])
                input_scale = self.get_input_details()[0]
                if x.dtype == np.int8:
                    scale, zero_point = output["quantization"]
                    threshold = yolo.defaultThreshold / scale + zero_point
                    combined_scale = scale * input_scale
                    if self.scrypted_yolov10:
                        objs = yolo.parse_yolov10(
                            x[0],
                            threshold,
                            scale=lambda v: (v - zero_point) * combined_scale,
                            confidence_scale=lambda v: (v - zero_point) * scale,
                        )
                    else:
                        objs = yolo.parse_yolov9(
                            x[0],
                            threshold,
                            scale=lambda v: (v - zero_point) * combined_scale,
                            confidence_scale=lambda v: (v - zero_point) * scale,
                        )
                else:
                    # this code path is unused.
                    objs = yolo.parse_yolov9(x[0], scale=lambda v: v * input_scale)
            else:
                tflite_common.set_input(interpreter, input)
                interpreter.invoke()
                objs = detect.get_objects(
                    interpreter, score_threshold=0.2, image_scale=(1, 1)
                )
            return objs

        objs = await asyncio.get_event_loop().run_in_executor(self.executor, predict)

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
