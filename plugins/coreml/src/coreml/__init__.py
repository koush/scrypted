from __future__ import annotations

import ast
import asyncio
import concurrent.futures
import os
import re
from typing import Any, List, Tuple

import coremltools as ct
import scrypted_sdk
from PIL import Image
from scrypted_sdk import Setting, SettingValue

from common import yolo
from coreml.face_recognition import CoreMLFaceRecognition
from coreml.custom_detection import CoreMLCustomDetection
from coreml.clip_embedding import CoreMLClipEmbedding
from coreml.segment import CoreMLSegmentation

try:
    from coreml.text_recognition import CoreMLTextRecognition
except:
    CoreMLTextRecognition = None
from predict import Prediction, PredictPlugin
from predict.rectangle import Rectangle

predictExecutor = concurrent.futures.ThreadPoolExecutor(1, "CoreML-Predict")

availableModels = [
    "Default",
    "scrypted_yolov9t_relu_test",
    "scrypted_yolov9c_relu",
    "scrypted_yolov9m_relu",
    "scrypted_yolov9s_relu",
    "scrypted_yolov9t_relu",
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


class CoreMLPlugin(
    PredictPlugin,
    scrypted_sdk.Settings,
    scrypted_sdk.DeviceProvider,
):
    def __init__(self, nativeId: str | None = None, forked: bool = False):
        super().__init__(nativeId=nativeId, forked=forked)

        # this used to work but a bug in macos is causing recompilation of the coreml models every time it restarts
        # and the cache is not reused and also not cleared until the whole system reboots.
        self.periodic_restart = False

        self.custom_models = {}

        model = self.storage.getItem("model") or "Default"
        if model == "Default" or model not in availableModels:
            if model != "Default":
                self.storage.setItem("model", "Default")
            model = "scrypted_yolov9c_relu"
        self.modelName = model

        print(f"model: {model}")

        model_path = self.downloadHuggingFaceModelLocalFallback(model)
        modelFile = os.path.join(model_path, f"{model}.mlpackage")
        print(model_path, modelFile)
        self.model = ct.models.MLModel(modelFile)

        self.modelspec = self.model.get_spec()
        self.inputdesc = self.modelspec.description.input[0]
        self.inputheight = self.inputdesc.type.imageType.height
        self.inputwidth = self.inputdesc.type.imageType.width
        self.input_name = self.model.get_spec().description.input[0].name

        self.labels = parse_labels(self.modelspec.description.metadata.userDefined)
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.2

        self.faceDevice = None
        self.textDevice = None
        self.clipDevice = None
        self.segmentDevice = None

        if not self.forked:
            asyncio.ensure_future(self.prepareRecognitionModels(), loop=self.loop)

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
                    "name": "CoreML Face Recognition",
                },
            )

            if CoreMLTextRecognition:
                await scrypted_sdk.deviceManager.onDeviceDiscovered(
                    {
                        "nativeId": "textrecognition",
                        "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                        "interfaces": [
                            scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
                            scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                        ],
                        "name": "CoreML Text Recognition",
                    },
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
                    "name": "CoreML CLIP Embedding",
                }
            )

            await scrypted_sdk.deviceManager.onDeviceDiscovered(
                {
                    "nativeId": "segment",
                    "type": scrypted_sdk.ScryptedDeviceType.Builtin.value,
                    "interfaces": [
                        scrypted_sdk.ScryptedInterface.ClusterForkInterface.value,
                        scrypted_sdk.ScryptedInterface.ObjectDetection.value,
                    ],
                    "name": "CoreML Segmentation",
                }
            )
        except:
            pass

    async def getDevice(self, nativeId: str) -> Any:
        if nativeId == "facerecognition":
            self.faceDevice = self.faceDevice or CoreMLFaceRecognition(self, nativeId)
            return self.faceDevice
        elif nativeId == "textrecognition":
            self.textDevice = self.textDevice or CoreMLTextRecognition(self, nativeId)
            return self.textDevice
        elif nativeId == "clipembedding":
            self.clipDevice = self.clipDevice or CoreMLClipEmbedding(self, nativeId)
            return self.clipDevice
        elif nativeId == "segment":
            self.segmentDevice = self.segmentDevice or CoreMLSegmentation(self, nativeId)
            return self.segmentDevice
        custom_model = self.custom_models.get(nativeId, None)
        if custom_model:
            return custom_model
        custom_model = CoreMLCustomDetection(self, nativeId)
        self.custom_models[nativeId] = custom_model
        await custom_model.reportDevice(nativeId, custom_model.providedName)
        return custom_model

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
        out_dict = await self.queue_batch({self.input_name: input})
        results = list(out_dict.values())[0][0]
        objs = yolo.parse_yolov9(results)
        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
