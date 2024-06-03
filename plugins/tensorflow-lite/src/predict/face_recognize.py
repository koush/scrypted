from __future__ import annotations

import asyncio
import base64
import traceback
from asyncio import Future
from typing import Any, List, Tuple

import numpy as np
import scrypted_sdk
from PIL import Image
from scrypted_sdk import (ObjectDetectionResult, ObjectDetectionSession,
                          ObjectsDetected)

from common import yolo
from predict import PredictPlugin


class FaceRecognizeDetection(PredictPlugin):
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

        self.detectModel = self.downloadModel("scrypted_yolov8n_flt_320")
        self.faceModel = self.downloadModel("inception_resnet_v1")

    def downloadModel(self, model: str):
        pass

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def get_input_format(self) -> str:
        return "rgb"

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        results = await self.predictDetectModel(input)
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

            output = await self.predictFaceModel(processed_tensor)

            b = output.tobytes()
            embedding = base64.b64encode(b).decode("utf-8")
            d["embedding"] = embedding
        except Exception as e:

            traceback.print_exc()
            pass

    async def predictDetectModel(self, input: Image.Image):
        pass

    async def predictFaceModel(self, prepareTensor):
        pass

    async def run_detection_image(
        self, image: scrypted_sdk.Image, detection_session: ObjectDetectionSession
    ) -> ObjectsDetected:
        ret = await super().run_detection_image(image, detection_session)

        detections = ret["detections"]

        # filter any non face detections because this is using an old model that includes plates and text
        detections = [d for d in detections if d["className"] == "face"]

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

        if len(futures):
            await asyncio.wait(futures)

        return ret
