from __future__ import annotations

import ast
import asyncio
import concurrent.futures
import os
import re
import threading
import traceback
from typing import Any, List, Tuple

import numpy as np
import scrypted_sdk
from PIL import Image
from scrypted_sdk import Setting, SettingValue

import ncnn
from common import yolo

try:
    from ncnn.face_recognition import NCNNFaceRecognition
except:
    NCNNFaceRecognition = None
try:
    from ncnn.text_recognition import NCNNTextRecognition
except:
    NCNNTextRecognition = None
from predict import Prediction, PredictPlugin
from predict.rectangle import Rectangle

predictExecutor = concurrent.futures.ThreadPoolExecutor(1, "NCNN-Predict")
prepareExecutor = concurrent.futures.ThreadPoolExecutor(1, "NCNN-Prepare")

availableModels = [
    "Default",
    "scrypted_yolov10m_320",
    "scrypted_yolov10n_320",
    "scrypted_yolo_nas_s_320",
    "scrypted_yolov9e_320",
    "scrypted_yolov9c_320",
    "scrypted_yolov9s_320",
    "scrypted_yolov9t_320",
    "scrypted_yolov6n_320",
    "scrypted_yolov6s_320",
    "scrypted_yolov8n_320",
    "ssdlite_mobilenet_v2",
    "yolov4-tiny",
]


def parse_label_contents(contents: str):
    lines = contents.split(",")
    lines = [line for line in lines if line.strip()]
    ret = {}
    for row_number, content in enumerate(lines):
        pair = re.split(r"[:\s]+", content.strip(), maxsplit=1)
        if len(pair) == 2 and pair[0].strip().isdigit():
            ret[int(pair[0])] = pair[1].strip()
        else:
            ret[row_number] = content.strip()
    return ret


def parse_labels(userDefined):
    yolo = userDefined.get("names") or userDefined.get("yolo.names")
    if yolo:
        j = ast.literal_eval(yolo)
        ret = {}
        for k, v in j.items():
            ret[int(k)] = v
        return ret

    classes = userDefined.get("classes")
    if not classes:
        raise Exception("no classes found in model metadata")
    return parse_label_contents(classes)


class NCNNPlugin(
    PredictPlugin,
    scrypted_sdk.Settings,
    scrypted_sdk.DeviceProvider,
):
    def __init__(self, nativeId: str | None = None, forked: bool = False):
        super().__init__(nativeId=nativeId, forked=forked)

        model = self.storage.getItem("model") or "Default"
        if model == "Default" or model not in availableModels:
            if model != "Default":
                self.storage.setItem("model", "Default")
            model = "scrypted_yolov9t_relu_320"
        self.scrypted_yolov10 = "scrypted_yolov10" in model
        self.scrypted_yolo_nas = "scrypted_yolo_nas" in model
        self.scrypted_yolo = "scrypted_yolo" in model
        self.scrypted_model = "scrypted" in model
        model_version = "v2"
        self.modelName = model

        print(f"model: {model}")

        if self.scrypted_yolo:
            self.labels = {
                0: "person",
                1: "vehicle",
                2: "animal",
            }
            files = [
                f"{model}/best_converted.ncnn.bin",
                f"{model}//best_converted.ncnn.param",
            ]

            for f in files:
                p = self.downloadFile(
                    f"https://github.com/koush/ncnn-models/raw/main/{f}",
                    f"{model_version}/{f}",
                )
                if ".bin" in p:
                    binFile = p
                if ".param" in p:
                    paramFile = p
        else:
            raise Exception("Unknown model. Please reinstall.")


        self.net = ncnn.Net()
        # self.net.opt.use_vulkan_compute = True
        # self.net.opt.use_winograd_convolution = False
        # self.net.opt.use_sgemm_convolution = False
        # self.net.opt.use_fp16_packed = False
        # self.net.opt.use_fp16_storage = False
        # self.net.opt.use_fp16_arithmetic = False
        # self.net.opt.use_int8_storage = False
        # self.net.opt.use_int8_arithmetic = False

        self.net.load_param(paramFile)
        self.net.load_model(binFile)

        self.input_name = self.net.input_names()[0]

        self.inputwidth = 320
        self.inputheight = 320
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.2


        # self.modelspec = self.model.get_spec()
        # self.inputdesc = self.modelspec.description.input[0]
        # self.inputheight = self.inputdesc.type.imageType.height
        # self.inputwidth = self.inputdesc.type.imageType.width
        # self.input_name = self.model.get_spec().description.input[0].name

        # self.labels = parse_labels(self.modelspec.description.metadata.userDefined)
        # self.loop = asyncio.get_event_loop()
        # self.minThreshold = 0.2

    #     self.faceDevice = None
    #     self.textDevice = None

    #     if not self.forked:
    #         asyncio.ensure_future(self.prepareRecognitionModels(), loop=self.loop)

    # async def prepareRecognitionModels(self):
    #     try:
    #         devices = [
    #             {
    #                 "nativeId": "facerecognition",
    #                 "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
    #                 "interfaces": [
    #                         scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
    #                     scrypted_sdk.ScryptedInterface.ObjectDetection.value,
    #                 ],
    #                 "name": "NCNN Face Recognition",
    #             },
    #         ]

    #         if NCNNTextRecognition:
    #             devices.append(
    #                 {
    #                     "nativeId": "textrecognition",
    #                     "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
    #                     "interfaces": [
    #                         scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
    #                         scrypted_sdk.ScryptedInterface.ObjectDetection.value,
    #                     ],
    #                     "name": "NCNN Text Recognition",
    #                 },
    #             )

    #         await scrypted_sdk.deviceManager.onDevicesChanged(
    #             {
    #                 "devices": devices,
    #             }
    #         )
    #     except:
    #         pass

    # async def getDevice(self, nativeId: str) -> Any:
    #     if nativeId == "facerecognition":
    #         self.faceDevice = self.faceDevice or NCNNFaceRecognition(self, nativeId)
    #         return self.faceDevice
    #     if nativeId == "textrecognition":
    #         self.textDevice = self.textDevice or NCNNTextRecognition(self, nativeId)
    #         return self.textDevice
    #     raise Exception("unknown device")

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

    async def putSetting(self, key: str, value: SettingValue):
        self.storage.setItem(key, value)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        await scrypted_sdk.deviceManager.requestRestart()

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    async def detect_batch(self, inputs: List[Any]) -> List[Any]:
        out_dicts = await asyncio.get_event_loop().run_in_executor(
            predictExecutor, lambda: self.model.predict(inputs)
        )
        return out_dicts

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def prepare():
            im = np.array(input)
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous
            return im

        def predict(input_tensor):
            input_ncnn = ncnn.Mat(input_tensor)
            ex = self.net.create_extractor()
            ex.input(self.input_name, input_ncnn)

            output_ncnn = ncnn.Mat()
            ex.extract("out0", output_ncnn)

            output_tensors =  np.array(output_ncnn)
            if self.scrypted_yolov10:
                return yolo.parse_yolov10(output_tensors)
            if self.scrypted_yolo_nas:
                return yolo.parse_yolo_nas([output_tensors[1], output_tensors[0]])
            return yolo.parse_yolov9(output_tensors)

        try:
            input_tensor = await asyncio.get_event_loop().run_in_executor(
                prepareExecutor, lambda: prepare()
            )
            objs = await asyncio.get_event_loop().run_in_executor(
                predictExecutor, lambda: predict(input_tensor)
            )

        except:

            traceback.print_exc()
            raise

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret

