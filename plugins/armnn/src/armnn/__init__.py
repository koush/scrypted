from __future__ import annotations

from PIL import Image
import numpy as np

import asyncio
import concurrent.futures
import hashlib
import os
import platform
import re
import shutil
import tarfile
import traceback
from typing import Any, Tuple

import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase
import tflite_runtime.interpreter as tflite
from scrypted_sdk.types import Setting, SettingValue

from common import yolo
from predict import PredictPlugin
from .tflite_common import *


availableModels = [
    "Default",
    "scrypted_yolov6n_320",
    "scrypted_yolov6s_320",
    "scrypted_yolov9c_320",
    "scrypted_yolov8n_320",
]

armnn_lib_url = "https://github.com/ARM-software/armnn/releases/download/v24.02/ArmNN-linux-aarch64.tar.gz"


def ensure_compatibility():
    err_msg = 'ArmNN plugin is only supported on Linux/ARM64 platforms.'
    if platform.machine() != 'aarch64':
        raise RuntimeError(err_msg)
    if platform.system() != 'Linux':
        raise RuntimeError(err_msg)


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


class ArmNNDetector(PredictPlugin):
    def __init__(self, model):
        super().__init__(nativeId=None)
        model_version = "v13"
        branch = "main"
        labelsFile = None

        def configureModel():
            nonlocal labelsFile
            nonlocal model

            self.yolo = "yolo" in model
            self.yolov9 = "yolov9" in model
            self.scrypted_model = "scrypted" in model

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

        def downloadModel():
            tflite_model = "best_full_integer_quant" if self.scrypted_model else model
            return self.downloadFile(
                f"https://github.com/koush/tflite-models/raw/{branch}/{model}/{tflite_model}{suffix}.tflite",
                f"{model_version}/{tflite_model}{suffix}.tflite",
            )

        suffix = ""
        configureModel()
        modelFile = downloadModel()

        armnn_tarball = self.downloadFile(armnn_lib_url, "armnn.tar.gz")
        tarball_hash = hashlib.sha256(open(armnn_tarball, "rb").read()).hexdigest()
        lib_extract_dir = os.path.join(os.path.dirname(armnn_tarball), "armnn")
        if os.path.exists(lib_extract_dir):
            if not os.path.exists(os.path.join(lib_extract_dir, tarball_hash)):
                shutil.rmtree(lib_extract_dir)
                os.makedirs(lib_extract_dir)
                print("extracting...")
                with tarfile.open(armnn_tarball, "r:gz") as tar:
                    tar.extractall(lib_extract_dir)
                with open(os.path.join(lib_extract_dir, tarball_hash), "w") as f:
                    f.write("")

        print(modelFile, labelsFile, lib_extract_dir)

        armnn_delegate = tflite.load_delegate(library=os.path.join(lib_extract_dir, "libarmnnDelegate.so"),
                                              options={"backends": "CpuAcc,GpuAcc,CpuRef"})
        self.interpreter = tflite.Interpreter(model_path=modelFile, experimental_delegates=[armnn_delegate])
        self.interpreter.allocate_tensors()
        _, height, width, channels = self.interpreter.get_input_details()[0]["shape"]
        self.input_details = int(width), int(height), int(channels)

        self.executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="tflite",
        )

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return self.input_details

    def get_input_size(self) -> Tuple[int, int]:
        return self.input_details[0:2]

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        def predict():
            interpreter = self.interpreter
            if self.yolo:
                tensor_index = tflite_common.input_details(interpreter, "index")

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
                raise Exception("only yolo models supported")
            return objs

        objs = await asyncio.get_event_loop().run_in_executor(self.executor, predict)

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret


class ArmNNPlugin(ScryptedDeviceBase, scrypted_sdk.ObjectDetection, scrypted_sdk.Settings):
    def __init__(self, nativeId=None) -> None:
        super().__init__(nativeId=nativeId)
        ensure_compatibility()

        model = self.model
        if model not in availableModels:
            self.storage.setItem("model", "Default")
            model = "Default"
        defaultModel = model == "Default"
        if defaultModel:
            model = "scrypted_yolov6n_320"

        armnn_tarball = PredictPlugin().downloadFile(armnn_lib_url, "armnn.tar.gz")
        lib_extract_dir = os.path.join(os.path.dirname(armnn_tarball), "armnn")
        os.environ["LD_LIBRARY_PATH"] = f"{lib_extract_dir}:" + os.environ.get("LD_LIBRARY_PATH", "")

        self.detector = asyncio.Future()
        asyncio.get_event_loop().create_task(self.async_init(model))

    async def async_init(self, model) -> None:
        fork = await scrypted_sdk.fork().result
        detector = await fork.get_detector(model)
        self.detector.set_result(detector)

    @property
    def model(self) -> str:
        try:
            return self.storage.getItem("model") or "Default"
        except:
            return "Default"

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

    async def detectObjects(self, mediaObject: scrypted_sdk.MediaObject, session: scrypted_sdk.ObjectDetectionSession = None) -> scrypted_sdk.ObjectsDetected:
        try:
            detector = await self.detector
            return await detector.detectObjects(mediaObject, session)
        except:
            traceback.print_exc()
            await scrypted_sdk.deviceManager.requestRestart()

    async def generateObjectDetections(self, videoFrames: scrypted_sdk.MediaObject | scrypted_sdk.VideoFrame, session: scrypted_sdk.ObjectDetectionGeneratorSession) -> scrypted_sdk.ObjectDetectionGeneratorResult:
        try:
            detector = await self.detector
            return await detector.generateObjectDetections(videoFrames, session)
        except:
            traceback.print_exc()
            await scrypted_sdk.deviceManager.requestRestart()

    async def getDetectionModel(self, settings: Any = None) -> scrypted_sdk.ObjectDetectionModel:
        try:
            detector = await self.detector
            return await detector.getDetectionModel(settings)
        except:
            traceback.print_exc()
            await scrypted_sdk.deviceManager.requestRestart()


class ArmNNFork:
    def get_detector(self, model) -> ArmNNDetector:
        return ArmNNDetector(model)


async def fork() -> ArmNNFork:
    return ArmNNFork()