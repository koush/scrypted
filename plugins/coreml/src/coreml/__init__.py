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

try:
    from coreml.text_recognition import CoreMLTextRecognition
except:
    CoreMLTextRecognition = None
from predict import Prediction, PredictPlugin
from predict.rectangle import Rectangle

predictExecutor = concurrent.futures.ThreadPoolExecutor(1, "CoreML-Predict")

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
            model = "scrypted_yolov9c_320"
        self.yolo = "yolo" in model
        self.scrypted_yolov10n = "scrypted_yolov10" in model
        self.scrypted_yolo_nas = "scrypted_yolo_nas" in model
        self.scrypted_yolo = "scrypted_yolo" in model
        self.scrypted_model = "scrypted" in model
        model_version = "v8"
        mlmodel = "model" if self.scrypted_yolo else model
        self.modelName = model

        print(f"model: {model}")

        if not self.yolo:
            # todo convert these to mlpackage
            modelFile = self.downloadFile(
                f"https://github.com/koush/coreml-models/raw/main/{model}/{mlmodel}.mlmodel",
                f"{model}.mlmodel",
            )
        else:
            if self.scrypted_yolo:
                files = [
                    f"{model}/{model}.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
                    f"{model}/{model}.mlpackage/Data/com.apple.CoreML/{mlmodel}.mlmodel",
                    f"{model}/{model}.mlpackage/Manifest.json",
                ]

                for f in files:
                    p = self.downloadFile(
                        f"https://github.com/koush/coreml-models/raw/main/{f}",
                        f"{model_version}/{f}",
                    )
                    modelFile = os.path.dirname(p)
            else:
                files = [
                    f"{model}/{model}.mlpackage/Data/com.apple.CoreML/FeatureDescriptions.json",
                    f"{model}/{model}.mlpackage/Data/com.apple.CoreML/Metadata.json",
                    f"{model}/{model}.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
                    f"{model}/{model}.mlpackage/Data/com.apple.CoreML/{mlmodel}.mlmodel",
                    f"{model}/{model}.mlpackage/Manifest.json",
                ]

                for f in files:
                    p = self.downloadFile(
                        f"https://github.com/koush/coreml-models/raw/main/{f}",
                        f"{model_version}/{f}",
                    )
                    modelFile = os.path.dirname(p)

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
        objs = []

        # run in executor if this is the plugin loop
        if self.yolo:
            out_dict = await self.queue_batch({self.input_name: input})

            if self.scrypted_yolov10n:
                results = list(out_dict.values())[0][0]
                objs = yolo.parse_yolov10(results)
                ret = self.create_detection_result(objs, src_size, cvss)
                return ret

            if self.scrypted_yolo_nas:
                predictions = list(out_dict.values())
                objs = yolo.parse_yolo_nas(predictions)
                ret = self.create_detection_result(objs, src_size, cvss)
                return ret

            if self.scrypted_yolo:
                results = list(out_dict.values())[0][0]
                objs = yolo.parse_yolov9(results)
                ret = self.create_detection_result(objs, src_size, cvss)
                return ret

            out_blob = out_dict["Identity"]

            objects = yolo.parse_yolo_region(
                out_blob,
                (input.width, input.height),
                (81, 82, 135, 169, 344, 319),
                #  (23,27, 37,58, 81,82),
                False,
            )

            for r in objects:
                obj = Prediction(
                    r["classId"],
                    r["confidence"],
                    Rectangle(
                        r["xmin"],
                        r["ymin"],
                        r["xmax"],
                        r["ymax"],
                    ),
                )
                objs.append(obj)

            # what about output[1]?
            # 26 26
            # objects = yolo.parse_yolo_region(out_blob, (input.width, input.height), (23,27, 37,58, 81,82))

            ret = self.create_detection_result(objs, src_size, cvss)
            return ret

        out_dict = await asyncio.get_event_loop().run_in_executor(
            predictExecutor,
            lambda: self.model.predict(
                {"image": input, "confidenceThreshold": self.minThreshold}
            ),
        )

        coordinatesList = out_dict["coordinates"]

        for index, confidenceList in enumerate(out_dict["confidence"]):
            values = confidenceList
            maxConfidenceIndex = max(range(len(values)), key=values.__getitem__)
            maxConfidence = confidenceList[maxConfidenceIndex]
            if maxConfidence < self.minThreshold:
                continue

            coordinates = coordinatesList[index]

            def torelative(value: float):
                return value * self.inputheight

            x = torelative(coordinates[0])
            y = torelative(coordinates[1])
            w = torelative(coordinates[2])
            h = torelative(coordinates[3])
            w2 = w / 2
            h2 = h / 2
            l = x - w2
            t = y - h2

            obj = Prediction(
                maxConfidenceIndex, maxConfidence, Rectangle(l, t, l + w, t + h)
            )
            objs.append(obj)

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
