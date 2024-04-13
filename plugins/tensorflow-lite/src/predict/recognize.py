from __future__ import annotations

import asyncio
from asyncio import Future
import base64
import concurrent.futures
import os
from typing import Any, Tuple, List

import numpy as np
# import Quartz
import scrypted_sdk
# from Foundation import NSData, NSMakeSize
from PIL import Image
from scrypted_sdk import (
    Setting,
    SettingValue,
    ObjectDetectionSession,
    ObjectsDetected,
    ObjectDetectionResult,
)
import traceback

# import Vision
from predict import PredictPlugin
from common import yolo
from common.text import prepare_text_result, process_text_result

def euclidean_distance(arr1, arr2):
    return np.linalg.norm(arr1 - arr2)


def cosine_similarity(vector_a, vector_b):
    dot_product = np.dot(vector_a, vector_b)
    norm_a = np.linalg.norm(vector_a)
    norm_b = np.linalg.norm(vector_b)
    similarity = dot_product / (norm_a * norm_b)
    return similarity


predictExecutor = concurrent.futures.ThreadPoolExecutor(8, "Recognize")

class RecognizeDetection(PredictPlugin):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        self.inputheight = 320
        self.inputwidth = 320

        self.labels = {
            0: "face",
            1: "plate",
            2: "text",
        }
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.7

        self.detectModel = self.downloadModel("scrypted_yolov9c_flt_320")
        self.textModel = self.downloadModel("vgg_english_g2")
        self.faceModel = self.downloadModel("inception_resnet_v1")

    def downloadModel(self, model: str):
        pass

    async def getSettings(self) -> list[Setting]:
        pass

    async def putSetting(self, key: str, value: SettingValue):
        self.storage.setItem(key, value)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        await scrypted_sdk.deviceManager.requestRestart()

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def get_input_format(self) -> str:
        return "rgb"

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        results = await asyncio.get_event_loop().run_in_executor(
            predictExecutor, lambda: self.predictDetectModel(input)
        )
        objs = yolo.parse_yolov9(results)
        ret = self.create_detection_result(objs, src_size, cvss)
        return ret

    async def setEmbedding(self, d: ObjectDetectionResult, image: scrypted_sdk.Image):
        try:
            l, t, w, h = d["boundingBox"]
            face = await image.toBuffer(
                {
                    "crop": {
                        "left": l,
                        "top": t,
                        "width": w,
                        "height": h,
                    },
                    "resize": {
                        "width": 160,
                        "height": 160,
                    },
                    "format": "rgb",
                }
            )

            faceImage = Image.frombuffer("RGB", (160, 160), face)
            image_tensor = np.array(faceImage).astype(np.float32).transpose([2, 0, 1])
            processed_tensor = (image_tensor - 127.5) / 128.0
            processed_tensor = np.expand_dims(processed_tensor, axis=0)

            output = await asyncio.get_event_loop().run_in_executor(
                predictExecutor,
                lambda: self.predictFaceModel(processed_tensor)
            )

            b = output.tobytes()
            embedding = base64.b64encode(b).decode("utf-8")
            d["embedding"] = embedding
        except Exception as e:

            traceback.print_exc()
            pass
    
    def predictTextModel(self, input):
        pass

    def predictDetectModel(self, input):
        pass

    def predictFaceModel(self, input):
        pass

    async def setLabel(self, d: ObjectDetectionResult, image: scrypted_sdk.Image):
        try:
            image_tensor = await prepare_text_result(d, image)
            out_dict = await asyncio.get_event_loop().run_in_executor(
                predictExecutor,
                lambda: self.predictTextModel(image_tensor),
            )
            preds = out_dict["linear_2"]
            d['label'] = process_text_result(preds)

        except Exception as e:
            traceback.print_exc()
            pass

    async def run_detection_image(
        self, image: scrypted_sdk.Image, detection_session: ObjectDetectionSession
    ) -> ObjectsDetected:
        ret = await super().run_detection_image(image, detection_session)

        detections = ret["detections"]
        # non max suppression on detections
        for i in range(len(detections)):
            d1 = detections[i]
            if d1["score"] < self.minThreshold:
                continue

            for j in range(i + 1, len(detections)):
                d2 = detections[j]

                if d2["score"] < self.minThreshold:
                    continue

                if d1["className"] != d2["className"]:
                    continue

                l1, t1, w1, h1 = d1["boundingBox"]
                l2, t2, w2, h2 = d2["boundingBox"]

                r1 = l1 + w1
                b1 = t1 + h1
                r2 = l2 + w2
                b2 = t2 + h2

                left = max(l1, l2)
                top = max(t1, t2)
                right = min(r1, r2)
                bottom = min(b1, b2)

                if left < right and top < bottom:
                    area1 = (r1 - l1) * (b1 - t1)
                    area2 = (r2 - l2) * (b2 - t2)
                    intersect = (right - left) * (bottom - top)
                    iou = intersect / (area1 + area2 - intersect)

                    if iou > 0.5:
                        if d1["score"] > d2["score"]:
                            d2["score"] = 0
                        else:
                            d1["score"] = 0

        # remove anything with score 0
        ret["detections"] = [d for d in detections if d["score"] >= self.minThreshold]

        futures: List[Future] = []

        for d in ret["detections"]:
            if d["className"] == "face":
                futures.append(asyncio.ensure_future(self.setEmbedding(d, image)))
            elif d["className"] == "plate":
                futures.append(asyncio.ensure_future(self.setLabel(d, image)))

        if len(futures):
            await asyncio.wait(futures)

        last = None
        for d in ret['detections']:
            if d["className"] != "face":
                continue
            check = d.get("embedding")
            if check is None:
                continue
            # decode base64 string check
            embedding = base64.b64decode(check)
            embedding = np.frombuffer(embedding, dtype=np.float32)
            if last is None:
                last = embedding
                continue
            # convert to numpy float32 arrays
            similarity = cosine_similarity(last, embedding)
            print('similarity', similarity)
            last = embedding

        return ret

