from __future__ import annotations

import asyncio
import concurrent.futures
import json
import re
import traceback
from typing import Any, Tuple

import numpy as np
import openvino.runtime as ov
import scrypted_sdk
from PIL import Image
from scrypted_sdk.other import SettingValue
from scrypted_sdk.types import Setting

import common.yolo as yolo
from predict import Prediction, PredictPlugin
from predict.rectangle import Rectangle

from .face_recognition import OpenVINOFaceRecognition

try:
    from .text_recognition import OpenVINOTextRecognition
except:
    OpenVINOTextRecognition = None

predictExecutor = concurrent.futures.ThreadPoolExecutor(1, "OpenVINO-Predict")
prepareExecutor = concurrent.futures.ThreadPoolExecutor(1, "OpenVINO-Prepare")

availableModels = [
    "Default",
    "scrypted_yolov9c_relu_int8_320",
    "scrypted_yolov10m_320",
    "scrypted_yolov10s_320",
    "scrypted_yolov10n_320",
    "scrypted_yolo_nas_s_320",
    "scrypted_yolov6n_320",
    "scrypted_yolov6s_320",
    "scrypted_yolov9c_320",
    "scrypted_yolov9m_320",
    "scrypted_yolov9s_320",
    "scrypted_yolov9t_320",
    "scrypted_yolov8n_320",
    "ssd_mobilenet_v1_coco",
    "ssdlite_mobilenet_v2",
    "yolo-v3-tiny-tf",
    "yolo-v4-tiny-tf",
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


def param_to_string(parameters) -> str:
    """Convert a list / tuple of parameters returned from IE to a string."""
    if isinstance(parameters, (list, tuple)):
        return ", ".join([str(x) for x in parameters])
    else:
        return str(parameters)


def dump_device_properties(core):
    print("Available devices:")
    for device in core.available_devices:
        print(f"{device} :")
        print("\tSUPPORTED_PROPERTIES:")
        for property_key in core.get_property(device, "SUPPORTED_PROPERTIES"):
            if property_key not in (
                "SUPPORTED_METRICS",
                "SUPPORTED_CONFIG_KEYS",
                "SUPPORTED_PROPERTIES",
            ):
                try:
                    property_val = core.get_property(device, property_key)
                except TypeError:
                    property_val = "UNSUPPORTED TYPE"
                print(f"\t\t{property_key}: {param_to_string(property_val)}")
        print("")


class OpenVINOPlugin(
    PredictPlugin,
    scrypted_sdk.BufferConverter,
    scrypted_sdk.Settings,
    scrypted_sdk.DeviceProvider,
):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        self.core = ov.Core()
        dump_device_properties(self.core)
        available_devices = self.core.available_devices
        self.available_devices = available_devices
        print("available devices: %s" % available_devices)

        nvidia = False
        iris_xe = False
        arc = False
        npu = False
        gpu = False

        dgpus = []
        # search for NVIDIA dGPU, as that is not preferred by AUTO for some reason?
        # todo: create separate core per NVIDIA dGPU as inference does not seem to
        # be distributed to multiple dGPU.
        for device in self.available_devices:
            try:
                full_device_name = self.core.get_property(device, "FULL_DEVICE_NAME")
                if "Iris" in full_device_name and "Xe" in full_device_name:
                    iris_xe = True
                if "Arc" in full_device_name:
                    arc = True
                if "NVIDIA" in full_device_name and "dGPU" in full_device_name:
                    dgpus.append(device)
                    nvidia = True
                if "NPU" in device:
                    npu = True
                if "GPU" in device:
                    gpu = True
            except:
                pass

        mode = self.storage.getItem("mode") or "Default"
        if mode == "Default":
            mode = "AUTO"

            if npu:
                if gpu:
                    mode = f"AUTO:NPU,GPU,CPU"
                else:
                    mode = f"AUTO:NPU,CPU"
            elif len(dgpus):
                mode = f"AUTO:{','.join(dgpus)},CPU"
            # forcing GPU can cause crashes on older GPU.
            elif gpu:
                mode = f"GPU"

        mode = mode or "AUTO"
        self.mode = mode

        # todo remove this, don't need to export two models anymore.
        precision = "FP16"
        self.precision = precision

        model = self.storage.getItem("model") or "Default"
        if model == "Default" or model not in availableModels:
            if model != "Default":
                self.storage.setItem("model", "Default")
            if arc or nvidia or npu:
                model = "scrypted_yolov9c_320"
            elif iris_xe:
                model = "scrypted_yolov9s_320"
            else:
                model = "scrypted_yolov9t_320"
        self.yolo = "yolo" in model
        self.scrypted_yolov9 = "scrypted_yolov9" in model
        self.scrypted_yolov10 = "scrypted_yolov10" in model
        self.scrypted_yolo_nas = "scrypted_yolo_nas" in model
        self.scrypted_yolo = "scrypted_yolo" in model
        self.scrypted_model = "scrypted" in model
        self.scrypted_yuv = "yuv" in model
        self.sigmoid = model == "yolo-v4-tiny-tf"
        self.modelName = model

        ovmodel = "best-converted" if self.scrypted_yolov9 else "best" if self.scrypted_model else model

        model_version = "v7"
        xmlFile = self.downloadFile(
            f"https://github.com/koush/openvino-models/raw/main/{model}/{precision}/{ovmodel}.xml",
            f"{model_version}/{model}/{precision}/{ovmodel}.xml",
        )
        binFile = self.downloadFile(
            f"https://github.com/koush/openvino-models/raw/main/{model}/{precision}/{ovmodel}.bin",
            f"{model_version}/{model}/{precision}/{ovmodel}.bin",
        )
        if self.scrypted_yolo_nas:
            labelsFile = self.downloadFile(
                "https://github.com/koush/openvino-models/raw/main/scrypted_nas_labels.txt",
                "scrypted_nas_labels.txt",
            )
        elif self.scrypted_model:
            labelsFile = self.downloadFile(
                "https://github.com/koush/openvino-models/raw/main/scrypted_labels.txt",
                "scrypted_labels.txt",
            )
        elif self.yolo:
            labelsFile = self.downloadFile(
                "https://github.com/koush/openvino-models/raw/main/coco_80cl.txt",
                "coco_80cl.txt",
            )
        else:
            labelsFile = self.downloadFile(
                "https://github.com/koush/openvino-models/raw/main/coco_labels.txt",
                "coco_labels.txt",
            )

        print(xmlFile, binFile, labelsFile)

        try:
            self.compiled_model = self.core.compile_model(xmlFile, mode)
        except:
            import traceback

            traceback.print_exc()

            if "GPU" in mode:
                try:
                    print(f"{mode} mode failed, reverting to AUTO.")
                    mode = "AUTO"
                    self.mode = mode
                    self.compiled_model = self.core.compile_model(xmlFile, mode)
                except:
                    print("Reverting all settings.")
                    self.storage.removeItem("mode")
                    self.storage.removeItem("model")
                    self.storage.removeItem("precision")
                    self.requestRestart()

        print(
            "EXECUTION_DEVICES",
            self.compiled_model.get_property("EXECUTION_DEVICES"),
        )
        print(f"model/mode/precision: {model}/{mode}/{precision}")

        # mobilenet 1,300,300,3
        # yolov3/4 1,416,416,3
        # yolov9 1,3,320,320
        # second dim is always good.
        self.model_dim = self.compiled_model.inputs[0].shape[2]

        labels_contents = open(labelsFile, "r").read()
        self.labels = parse_label_contents(labels_contents)

        self.faceDevice = None
        self.textDevice = None
        asyncio.ensure_future(self.prepareRecognitionModels(), loop=self.loop)

    async def getSettings(self) -> list[Setting]:
        mode = self.storage.getItem("mode") or "Default"
        model = self.storage.getItem("model") or "Default"
        precision = self.storage.getItem("precision") or "Default"
        return [
            {
                "title": "Available Devices",
                "description": "The devices that will be used for detection.",
                "value": json.dumps(self.available_devices),
                "readonly": True,
                "key": "available_devices",
            },
            {
                "key": "model",
                "title": "Model",
                "description": "The detection model used to find objects.",
                "choices": availableModels,
                "value": model,
            },
            {
                "key": "mode",
                "title": "Mode",
                "description": "AUTO, CPU, or GPU mode to use for detections. Requires plugin reload. Use CPU if the system has unreliable GPU drivers.",
                "choices": [
                    "Default",
                    "AUTO",
                    "CPU",
                    "GPU",
                ],
                "value": mode,
                "combobox": True,
            },
        ]

    async def putSetting(self, key: str, value: SettingValue):
        self.storage.setItem(key, value)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        self.requestRestart()

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return [self.model_dim, self.model_dim, 3]

    def get_input_size(self) -> Tuple[int, int]:
        return [self.model_dim, self.model_dim]

    def get_input_format(self):
        if self.scrypted_yuv:
            return "yuvj444p"
        return super().get_input_format()

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def predict(input_tensor):
            infer_request = self.compiled_model.create_infer_request()
            infer_request.set_input_tensor(input_tensor)
            output_tensors = infer_request.infer()

            objs = []

            if self.scrypted_yolo:
                if self.scrypted_yolov10:
                    return yolo.parse_yolov10(output_tensors[0][0])
                if self.scrypted_yolo_nas:
                    return yolo.parse_yolo_nas([output_tensors[1], output_tensors[0]])
                return yolo.parse_yolov9(output_tensors[0][0])

            if self.yolo:
                # index 2 will always either be 13 or 26
                # index 1 may be 13/26 or 255 depending on yolo 3 vs 4
                if infer_request.outputs[0].data.shape[2] == 13:
                    out_blob = infer_request.outputs[0]
                else:
                    out_blob = infer_request.outputs[1]

                # 13 13
                objects = yolo.parse_yolo_region(
                    out_blob.data,
                    (input.width, input.height),
                    (81, 82, 135, 169, 344, 319),
                    self.sigmoid,
                )

                for r in objects:
                    obj = Prediction(
                        r["classId"],
                        r["confidence"],
                        Rectangle(r["xmin"], r["ymin"], r["xmax"], r["ymax"]),
                    )
                    objs.append(obj)

                # what about output[1]?
                # 26 26
                # objects = yolo.parse_yolo_region(out_blob, (input.width, input.height), (,27, 37,58, 81,82))

                return objs

            output = infer_request.get_output_tensor(0)
            for values in output.data[0][0]:
                valid, index, confidence, l, t, r, b = values
                if valid == -1:
                    break

                def torelative(value: float):
                    return value * self.model_dim

                l = torelative(l)
                t = torelative(t)
                r = torelative(r)
                b = torelative(b)

                obj = Prediction(index - 1, confidence, Rectangle(l, t, r, b))
                objs.append(obj)

            return objs

        def prepare():
            # the input_tensor can be created with the shared_memory=True parameter,
            # but that seems to cause issues on some platforms.
            if self.scrypted_yolo:
                if not self.scrypted_yuv:
                    im = np.expand_dims(input, axis=0)
                    im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
                else:
                    # when a yuv image is requested, it may be either planar or interleaved
                    # as as hack, the input will come as RGB if already planar.
                    if input.mode != "RGB":
                        im = np.array(input)
                        im = im.reshape((1, self.model_dim, self.model_dim, 3))
                        im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)

                    else:
                        im = np.array(input)
                        im = im.reshape((1, 3, self.model_dim, self.model_dim))
                im = im.astype(np.float32) / 255.0
                im = np.ascontiguousarray(im)  # contiguous
                input_tensor = ov.Tensor(array=im)
            elif self.yolo:
                input_tensor = ov.Tensor(
                    array=np.expand_dims(np.array(input), axis=0).astype(np.float32)
                )
            else:
                input_tensor = ov.Tensor(array=np.expand_dims(np.array(input), axis=0))
            return input_tensor

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

    async def prepareRecognitionModels(self):
        try:
            devices = [
                {
                    "nativeId": "facerecognition",
                    "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                    "interfaces": [
                        scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                    ],
                    "name": "OpenVINO Face Recognition",
                },
            ]

            if OpenVINOTextRecognition:
                devices.append(
                    {
                        "nativeId": "textrecognition",
                        "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                        "interfaces": [
                            scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                        ],
                        "name": "OpenVINO Text Recognition",
                    },
                )

            await scrypted_sdk.deviceManager.onDevicesChanged(
                {
                    "devices": devices,
                }
            )
        except:
            pass

    async def getDevice(self, nativeId: str) -> Any:
        if nativeId == "facerecognition":
            self.faceDevice = self.faceDevice or OpenVINOFaceRecognition(self, nativeId)
            return self.faceDevice
        elif nativeId == "textrecognition":
            self.textDevice = self.textDevice or OpenVINOTextRecognition(self, nativeId)
            return self.textDevice
        raise Exception("unknown device")
