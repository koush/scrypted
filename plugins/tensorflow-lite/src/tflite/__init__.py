from __future__ import annotations

from PIL import Image
from pycoral.adapters import detect

from .common import *

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
import traceback
from typing import Any, Tuple

import scrypted_sdk
import tflite_runtime.interpreter as tflite
from scrypted_sdk.types import Setting, SettingValue

import yolo
from predict import PredictPlugin


def parse_label_contents(contents: str):
    lines = contents.splitlines()
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

        model_version = "v5"
        model = self.storage.getItem("model") or "Default"
        defaultModel = model == "Default"

        labelsFile = None
        def configureModel():
            nonlocal labelsFile
            nonlocal model

            if defaultModel:
                if edge_tpus:
                    usb_tpus = list(filter(lambda t: t['type'] == 'usb', edge_tpus))
                    if not len(usb_tpus):
                        model = "yolov8n_full_integer_quant"
                    else:
                        print('USB EdgeTPU is not compatible with YOLOv8. Falling back to SSDLite MobileNet V2.')
                        model = "ssd_mobilenet_v2_coco_quant_postprocess"
                else:
                    model = "ssd_mobilenet_v2_coco_quant_postprocess"
            self.yolo = "yolo" in model
            self.yolov8 = "yolov8" in model

            print(f'model: {model}')

            if self.yolo:
                labelsFile = self.downloadFile(
                    "https://raw.githubusercontent.com/koush/tflite-models/main/coco_80cl.txt",
                    f"{model_version}/coco_80cl.txt",
                )
            else:
                labelsFile = self.downloadFile(
                    "https://raw.githubusercontent.com/koush/tflite-models/main/coco_labels.txt",
                    f"{model_version}/coco_labels.txt",
                )

            labels_contents = open(labelsFile, "r").read()
            self.labels = parse_label_contents(labels_contents)

        self.interpreters = queue.Queue()
        self.interpreter_count = 0

        def downloadModel():
            return self.downloadFile(
                f"https://github.com/koush/tflite-models/raw/main/{model}/{model}{suffix}.tflite",
                f"{model_version}/{model}{suffix}.tflite",
            )

        try:
            if edge_tpus:
                configureModel()
                suffix = "_edgetpu"
                modelFile = downloadModel()
                self.edge_tpu_found = str(edge_tpus)
                for idx, edge_tpu in enumerate(edge_tpus):
                    try:
                        interpreter = make_interpreter(modelFile, ":%s" % idx)
                        interpreter.allocate_tensors()
                        _, height, width, channels = interpreter.get_input_details()[0][
                            "shape"
                        ]
                        self.input_details = int(width), int(height), int(channels)
                        self.interpreters.put(interpreter)
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
            self.interpreters.put(interpreter)
            self.interpreter_count = self.interpreter_count + 1

        print(modelFile, labelsFile)

        self.executor = concurrent.futures.ThreadPoolExecutor(
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
                "choices": [
                    "Default",
                    "ssd_mobilenet_v2_coco_quant_postprocess",
                    "yolov8n_full_integer_quant",
                ],
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
            interpreter = self.interpreters.get()
            try:
                if self.yolo:
                    tensor_index = input_details(interpreter, 'index')

                    im = np.stack([input])
                    i = interpreter.get_input_details()[0]
                    if i['dtype'] == np.int8:
                        im = im.view(np.int8)
                    else:
                        im = im.astype(np.float32) / 255.0
                    interpreter.set_tensor(tensor_index, im)
                    interpreter.invoke()
                    output_details = interpreter.get_output_details()
                    y = []
                    for output in output_details:
                        x = interpreter.get_tensor(output['index'])
                        if output['dtype'] == np.int8:
                            scale, zero_point = output['quantization']
                            x = (x.astype(np.float32) - zero_point) * scale  # re-scale
                        y.append(x)

                    if len(y) == 2:  # segment with (det, proto) output order reversed
                        if len(y[1].shape) != 4:
                            y = list(reversed(y))  # should be y = (1, 116, 8400), (1, 160, 160, 32)
                        y[1] = np.transpose(y[1], (0, 3, 1, 2))  # should be y = (1, 116, 8400), (1, 32, 160, 160)
                    y = [x if isinstance(x, np.ndarray) else x.numpy() for x in y]
                    objs = yolo.parse_yolov8(y[0][0], scale=640)
                else:
                    common.set_input(interpreter, input)
                    interpreter.invoke()
                    objs = detect.get_objects(
                        interpreter, score_threshold=0.2, image_scale=(1, 1)
                    )
                return objs
            except:
                traceback.print_exc()
                print(
                    "tensorflow-lite encountered an error while detecting. requesting plugin restart."
                )
                self.requestRestart()
                raise e
            finally:
                self.interpreters.put(interpreter)

        objs = await asyncio.get_event_loop().run_in_executor(self.executor, predict)

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
