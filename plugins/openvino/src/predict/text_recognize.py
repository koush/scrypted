from __future__ import annotations

import asyncio
import concurrent.futures
import traceback
from asyncio import Future
from typing import Any, List, Tuple

import numpy as np
import scrypted_sdk
from PIL import Image
from scrypted_sdk import ObjectDetectionResult, ObjectDetectionSession, ObjectsDetected

from common.text import prepare_text_result, process_text_result
from predict import Prediction, PredictPlugin
from predict.craft_utils import normalizeMeanVariance
from predict.rectangle import Rectangle
from predict.text_skew import find_adjacent_groups

from .craft_utils import adjustResultCoordinates, getDetBoxes

predictExecutor = concurrent.futures.ThreadPoolExecutor(1, "TextDetect")


class TextRecognition(PredictPlugin):
    def __init__(self, plugin: PredictPlugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

        self.inputheight = 640
        self.inputwidth = 640

        self.labels = {
            0: "text",
        }
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.1

        self.detectModel = self.downloadModel("craft")
        self.textModel = self.downloadModel("vgg_english_g2")

    def downloadModel(self, model: str):
        pass

    async def predictDetectModel(self, input: np.ndarray):
        pass

    async def predictTextModel(self, input: np.ndarray):
        pass

    async def detect_once(
        self, input: Image.Image, settings: Any, src_size, cvss
    ) -> scrypted_sdk.ObjectsDetected:
        image_tensor = normalizeMeanVariance(np.array(input))
        # reshape to c w h
        image_tensor = image_tensor.transpose([2, 0, 1])
        # add extra dimension to tensor
        image_tensor = np.expand_dims(image_tensor, axis=0)

        y = await self.predictDetectModel(image_tensor)

        estimate_num_chars = False
        ratio_h = ratio_w = 1
        text_threshold = 0.7
        link_threshold = 0.9
        low_text = 0.5
        poly = False

        boxes_list, polys_list, scores_list = [], [], []
        for out in y:
            # make score and link map
            score_text = out[:, :, 0]
            score_link = out[:, :, 1]

            # Post-processing
            boxes, polys, mapper, scores = getDetBoxes(
                score_text,
                score_link,
                text_threshold,
                link_threshold,
                low_text,
                poly,
                estimate_num_chars,
            )
            if not len(boxes):
                continue

            # coordinate adjustment
            boxes = adjustResultCoordinates(boxes, ratio_w, ratio_h)
            polys = adjustResultCoordinates(polys, ratio_w, ratio_h)
            if estimate_num_chars:
                boxes = list(boxes)
                polys = list(polys)
            for k in range(len(polys)):
                if estimate_num_chars:
                    boxes[k] = (boxes[k], mapper[k])
                if polys[k] is None:
                    polys[k] = boxes[k]
            boxes_list.append(boxes)
            scores_list.append(scores)
            polys_list.append(polys)

        preds: List[Prediction] = []
        for boxes, scores in zip(boxes_list, scores_list):
            for box, score in zip(boxes, scores):
                tl, tr, br, bl = box
                l = min(tl[0], bl[0])
                t = min(tl[1], tr[1])
                r = max(tr[0], br[0])
                b = max(bl[1], br[1])

                pred = Prediction(0, float(score), Rectangle(l, t, r, b))
                preds.append(pred)

        return self.create_detection_result(preds, src_size, cvss)

    async def run_detection_image(
        self, image: scrypted_sdk.Image, detection_session: ObjectDetectionSession
    ) -> ObjectsDetected:
        ret = await super().run_detection_image(image, detection_session)

        detections = ret["detections"]

        futures: List[Future] = []

        boundingBoxes, scores = [d["boundingBox"] for d in detections], [d["score"] for d in detections]
        if not len(boundingBoxes):
            return ret

        text_groups = find_adjacent_groups(boundingBoxes, scores)

        detections = []
        for group in text_groups:
            boundingBox = group["union"]
            score = group["score"]
            d: ObjectDetectionResult = {
                "boundingBox": boundingBox,
                "score": score,
                "className": "text",
            }
            futures.append(
                asyncio.ensure_future(self.setLabel(d, image, group["skew_angle"], group['deskew_height']))
            )
            detections.append(d)

        ret["detections"] = detections

        if len(futures):
            await asyncio.wait(futures)

        # filter empty labels
        ret["detections"] = [d for d in detections if d.get("label")]

        return ret

    async def setLabel(
        self, d: ObjectDetectionResult, image: scrypted_sdk.Image, skew_angle: float, deskew_height: float
    ):
        try:
            image_tensor = await prepare_text_result(d, image, skew_angle, deskew_height)
            preds = await self.predictTextModel(image_tensor)
            d["label"] = process_text_result(preds)

        except Exception as e:
            traceback.print_exc()
            pass

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def get_input_format(self) -> str:
        return "rgb"
