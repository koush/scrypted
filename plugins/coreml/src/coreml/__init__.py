from __future__ import annotations
import re
import scrypted_sdk
from scrypted_sdk import SettingValue, Setting
from typing import Any, Tuple
from predict import PredictPlugin, Prediction, Rectangle
import coremltools as ct
import os
from PIL import Image
import asyncio
import concurrent.futures
import yolo

predictExecutor = concurrent.futures.ThreadPoolExecutor(8, "CoreML-Predict")


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


class CoreMLPlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        model = self.storage.getItem("model") or "Default"
        if model == "Default":
            model = "ssdlite_mobilenet_v2"
        self.yolo = model == "yolov4-tiny"
        model_version = "v1"

        if not self.yolo:
            # todo convert these to mlpackage
            labelsFile = self.downloadFile(
                f"https://github.com/koush/coreml-models/raw/main/{model}/coco_labels.txt",
                "coco_labels.txt",
            )
            modelFile = self.downloadFile(
                f"https://github.com/koush/coreml-models/raw/main/{model}/{model}.mlmodel",
                "{model}.mlmodel",
            )
        else:
            files = [
                f"{model}/{model}.mlpackage/Data/com.apple.CoreML/FeatureDescriptions.json",
                f"{model}/{model}.mlpackage/Data/com.apple.CoreML/Metadata.json",
                f"{model}/{model}.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
                f"{model}/{model}.mlpackage/Data/com.apple.CoreML/{model}.mlmodel",
                f"{model}/{model}.mlpackage/Manifest.json",
            ]

            for f in files:
                p = self.downloadFile(
                    f"https://github.com/koush/coreml-models/raw/main/{f}",
                    f"{model_version}/{f}",
                )
                modelFile = os.path.dirname(p)

            labelsFile = self.downloadFile(
                f"https://github.com/koush/coreml-models/raw/main/{model}/coco_80cl.txt",
                f"{model_version}/{model}/coco_80cl.txt",
            )

        self.model = ct.models.MLModel(modelFile)

        self.modelspec = self.model.get_spec()
        self.inputdesc = self.modelspec.description.input[0]
        self.inputheight = self.inputdesc.type.imageType.height
        self.inputwidth = self.inputdesc.type.imageType.width

        labels_contents = open(labelsFile, "r").read()
        self.labels = parse_label_contents(labels_contents)
        # csv in mobilenet model
        # self.modelspec.description.metadata.userDefined['classes']
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.2

    async def getSettings(self) -> list[Setting]:
        model = self.storage.getItem("model") or "Default"
        return [
            {
                "key": "model",
                "title": "Model",
                "description": "The detection model used to find objects.",
                "choices": [
                    "Default",
                    "ssd_mobilenet_v1_coco",
                    "yolov4-tiny",
                ],
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

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        objs = []

        # run in executor if this is the plugin loop
        if self.yolo:
            if asyncio.get_event_loop() is self.loop:
                out_dict = await asyncio.get_event_loop().run_in_executor(
                    predictExecutor, lambda: self.model.predict({"input_1": input})
                )
            else:
                out_dict = self.model.predict({"input_1": input})
            out_blob = out_dict["Identity"]
            # out_blob = out_dict["Identity_1"]

            objects = yolo.parse_yolo_region(
                out_blob,
                (input.width, input.height),
                (81, 82, 135, 169, 344, 319),
                #  (23,27, 37,58, 81,82),
                False,
            )

            for r in objects:
                obj = Prediction(
                    r["classId"].astype(float),
                    r["confidence"].astype(float),
                    Rectangle(
                        r["xmin"].astype(float),
                        r["ymin"].astype(float),
                        r["xmax"].astype(float),
                        r["ymax"].astype(float),
                    ),
                )
                objs.append(obj)

            # what about output[1]?
            # 26 26
            # objects = yolo.parse_yolo_region(out_blob, (input.width, input.height), (23,27, 37,58, 81,82))

            ret = self.create_detection_result(objs, src_size, cvss)
            return ret

        if asyncio.get_event_loop() is self.loop:
            out_dict = await asyncio.get_event_loop().run_in_executor(
                predictExecutor,
                lambda: self.model.predict(
                    {"image": input, "confidenceThreshold": self.minThreshold}
                ),
            )
        else:
            out_dict = self.model.predict(
                {"image": input, "confidenceThreshold": self.minThreshold}
            )

        coordinatesList = out_dict["coordinates"].astype(float)

        for index, confidenceList in enumerate(out_dict["confidence"].astype(float)):
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
