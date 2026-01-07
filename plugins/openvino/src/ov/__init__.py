from __future__ import annotations

import asyncio
import concurrent.futures
import json
import re
import traceback
from typing import Any, Tuple

import numpy as np
import scrypted_sdk
from PIL import Image
from scrypted_sdk.other import SettingValue
from scrypted_sdk.types import Setting

import common.yolo as yolo
import openvino as ov
from predict import PredictPlugin

from .custom_detection import OpenVINOCustomDetection
from .face_recognition import OpenVINOFaceRecognition

try:
    from .text_recognition import OpenVINOTextRecognition
except:
    OpenVINOTextRecognition = None

from .clip_embedding import OpenVINOClipEmbedding

predictExecutor = concurrent.futures.ThreadPoolExecutor(
    thread_name_prefix="OpenVINO-Predict"
)
prepareExecutor = concurrent.futures.ThreadPoolExecutor(
    thread_name_prefix="OpenVINO-Prepare"
)

availableModels = [
    "Default",
    "scrypted_yolov9c_relu_int8_320",
    "scrypted_yolov9m_relu_int8_320",
    "scrypted_yolov9s_relu_int8_320",
    "scrypted_yolov9t_relu_int8_320",
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
    def __init__(self, nativeId: str | None = None, forked: bool = False):
        super().__init__(nativeId=nativeId, forked=forked)

        self.custom_models = {}

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

        # AUTO mode can cause conflicts or hide errors with NPU and GPU
        # so try to be explicit and fall back accordingly.
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

        model = self.storage.getItem("model") or "Default"
        if model == "Default" or model not in availableModels:
            # relu + int8 wins out by a mile on gpu and npu.
            # observation is that silu + float is faster than silu + int8 on gpu.
            # possibly due to quantization causing complexity at the activation function?
            # however, silu + int8 is faster than silu + float on cpu. (tested on wyse 5070)
            if model != "Default":
                self.storage.setItem("model", "Default")
            if arc or nvidia or npu:
                model = "scrypted_yolov9c_relu_int8_320"
            elif iris_xe:
                model = "scrypted_yolov9s_relu_int8_320"
            else:
                model = "scrypted_yolov9t_relu_int8_320"
        self.modelName = model

        ovmodel = "best-converted"

        model_version = "v7"
        xmlFile = self.downloadFile(
            f"https://huggingface.co/scrypted/plugin-models/resolve/main/openvino/{model}/{ovmodel}.xml",
            f"{model_version}/{model}/{ovmodel}.xml",
        )
        self.downloadFile(
            f"https://huggingface.co/scrypted/plugin-models/resolve/main/openvino/{model}/{ovmodel}.bin",
            f"{model_version}/{model}/{ovmodel}.bin",
        )

        try:
            self.compiled_model = self.core.compile_model(xmlFile, mode)
        except:
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
                    self.requestRestart()

        self.infer_queue = ov.AsyncInferQueue(self.compiled_model)

        def predict(output):
            return yolo.parse_yolov9(output[0])

        def callback(infer_request, future: asyncio.Future):
            try:
                output = infer_request.get_output_tensor(0).data
                objs = predict(output)
                self.loop.call_soon_threadsafe(future.set_result, objs)
            except Exception as e:
                self.loop.call_soon_threadsafe(future.set_exception, e)

        self.infer_queue.set_callback(callback)

        print(
            "EXECUTION_DEVICES",
            self.compiled_model.get_property("EXECUTION_DEVICES"),
        )
        print(f"model/mode: {model}/{mode}")

        self.model_dim = self.compiled_model.inputs[0].shape[2]

        self.labels = {
            0: 'person',
            1: 'vehicle',
            2: 'animal',
        }

        self.faceDevice = None
        self.textDevice = None
        self.clipDevice = None

        if not self.forked:
            asyncio.ensure_future(self.prepareRecognitionModels(), loop=self.loop)

    async def getSettings(self) -> list[Setting]:
        mode = self.storage.getItem("mode") or "Default"
        model = self.storage.getItem("model") or "Default"
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
        return super().get_input_format()

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def prepare():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous
            return im

        try:
            input_tensor = await asyncio.get_event_loop().run_in_executor(
                prepareExecutor, lambda: prepare()
            )
            f = asyncio.Future(loop=self.loop)
            self.infer_queue.start_async(input_tensor, f)
            objs = await f
        except:
            traceback.print_exc()
            raise

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret

    async def prepareRecognitionModels(self):
        try:
            await scrypted_sdk.deviceManager.onDeviceDiscovered(
                {
                    "nativeId": "facerecognition",
                    "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                    "interfaces": [
                        scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
                        scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                    ],
                    "name": "OpenVINO Face Recognition",
                },
            )

            if OpenVINOTextRecognition:
                await scrypted_sdk.deviceManager.onDeviceDiscovered(
                    {
                        "nativeId": "textrecognition",
                        "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                        "interfaces": [
                            scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
                            scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                        ],
                        "name": "OpenVINO Text Recognition",
                    }
                )

            await scrypted_sdk.deviceManager.onDeviceDiscovered(
                {
                    "nativeId": "clipembedding",
                    "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                    "interfaces": [
                        scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
                        scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                        scrypted_sdk.ScryptedInterface.TextEmbedding.value,
                        scrypted_sdk.ScryptedInterface.ImageEmbedding.value,
                    ],
                    "name": "OpenVINO CLIP Embedding",
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
        elif nativeId == "clipembedding":
            self.clipDevice = self.clipDevice or OpenVINOClipEmbedding(self, nativeId)
            return self.clipDevice
        custom_model = self.custom_models.get(nativeId, None)
        if custom_model:
            return custom_model
        custom_model = OpenVINOCustomDetection(self, nativeId)
        self.custom_models[nativeId] = custom_model
        await custom_model.reportDevice(nativeId, custom_model.providedName)
        return custom_model
