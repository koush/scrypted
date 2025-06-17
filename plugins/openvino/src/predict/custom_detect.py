from __future__ import annotations

import asyncio
from typing import Any, List, Tuple
import json

import numpy as np
from PIL import Image
from scrypted_sdk import (ObjectDetectionResult, ObjectDetectionSession,
                          ObjectsDetected)
import scrypted_sdk

from common import yolo
from predict import PredictPlugin
from common import softmax

from common.path_tools import replace_last_path_component

def safe_parse_json(value: str):
    try:
        return json.loads(value)
    except Exception:
        return None

class CustomDetection(PredictPlugin, scrypted_sdk.Settings):
    def __init__(self, plugin: PredictPlugin, nativeId: str):
        super().__init__(nativeId=nativeId, plugin=plugin)

        if not hasattr(self, "prefer_relu"):
            self.prefer_relu = False

        self.inputheight = 320
        self.inputwidth = 320

        self.labels = {}
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.5

        self.init_model()

        # self.detectModel = self.downloadModel("scrypted_yolov9t_relu_face_320" if self.prefer_relu else "scrypted_yolov9t_face_320")
        # self.faceModel = self.downloadModel("inception_resnet_v1")

    def init_model(self):
        config_url = self.storage.getItem('config_url')
        if not config_url:
            return
        config_str = self.storage.getItem('config')
        if not config_str:
            return
        config = json.loads(config_str)
        self.model_config = config
        for key in self.model_config['labels']:
            self.labels[int(key)] = self.model_config['labels'][key]
        self.inputwidth = config["input_shape"][2]
        self.inputheight = config["input_shape"][3]
        files: list[str] = config["files"]
        local_files: list[str] = []
        for file in files:
            remote_file = replace_last_path_component(config_url, file)
            localFile = self.downloadFile(remote_file, f"{self.id}/{file}")
            local_files.append(localFile)

        self.model = self.loadModel(local_files)

    def loadModel(self, files: list[str]):
        pass

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def get_input_format(self) -> str:
        return "rgb"

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        results = await self.predictModel(input)
        if self.model_config["model"] == "yolov9":
            objs = yolo.parse_yolov9(results)
            ret = self.create_detection_result(objs, src_size, cvss)
            return ret
        elif self.model_config["model"] == "resnet":
            exclude_classes = safe_parse_json(self.storage.getItem('excludeClasses')) or []
            while len(exclude_classes):
                excluded_class = exclude_classes.pop()
                for idx, class_name in self.labels.items():
                    if class_name == excluded_class:
                        results[idx] = 0
            sm = softmax.softmax(results)
            # get anything over the threshold, sort by score, top 3
            min_indexes = np.where(sm > self.minThreshold)[0]
            min_indexes = min_indexes[np.argsort(sm[min_indexes])[::-1]]
            min_indexes = min_indexes[:3]
            detection_result: ObjectsDetected = {}
            detections: List[ObjectDetectionResult] = []
            detection_result["detections"] = detections
            detection_result["inputDimensions"] = src_size
            for idx in min_indexes:
                label = self.labels[int(idx)]
                score = float(sm[int(idx)])
                detections.append(
                    {
                        "className": label,
                        "score": score,
                    }
                )
            return detection_result
        else:
            raise ValueError("Unknown model type")

    async def predictModel(self, input: Image.Image) -> ObjectsDetected:
        pass

    async def getSettings(self):
        return [
            {
                'key': 'excludeClasses',
                'title': 'Exclude Classes',
                'description': 'Classes to exclude from detection.',
                'multiple': True,
                'choices': list(self.labels.values()),
                'value': safe_parse_json(self.storage.getItem('excludeClasses')),
            }
        ]
    
    async def putSetting(self, key: str, value: str):
        if value:
            self.storage.setItem(key, json.dumps(value))
        else:
            self.storage.removeItem(key)
        await scrypted_sdk.deviceManager.onDeviceEvent(self.nativeId, scrypted_sdk.ScryptedInterface.Settings.value, None)

