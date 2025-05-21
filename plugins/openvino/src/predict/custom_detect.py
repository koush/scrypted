from __future__ import annotations

import asyncio
from urllib.parse import urlparse, urlunparse
from typing import Any, List, Tuple
import json

import numpy as np
from PIL import Image
from scrypted_sdk import (ObjectDetectionResult, ObjectDetectionSession,
                          ObjectsDetected)

from common import yolo
from predict import PredictPlugin
from common import softmax

def replace_last_path_component(url, new_path):
    # Parse the original URL
    parsed_url = urlparse(url)
    
    # Split the path into components
    path_components = parsed_url.path.split('/')
    
    # Remove the last component
    if len(path_components) > 1:
        path_components.pop()
    else:
        raise ValueError("URL path has no components to replace")

    # Join the path components back together
    new_path = '/'.join(path_components) + '/' + new_path
    
    # Create a new parsed URL with the updated path
    new_parsed_url = parsed_url._replace(path=new_path)
    
    # Reconstruct the URL
    new_url = urlunparse(new_parsed_url)
    
    return new_url

class CustomDetection(PredictPlugin):
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
            sm = softmax.softmax(results)
            idx = np.argmax(sm, axis=0)
            label = self.labels[int(idx)]
            score = float(sm[int(idx)])
            detection_result: ObjectsDetected = {}
            detections: List[ObjectDetectionResult] = []
            detection_result["detections"] = detections
            detection_result["inputDimensions"] = src_size
            if score > self.minThreshold:
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
