from __future__ import annotations

import asyncio
from asyncio import Future
import base64
import concurrent.futures
import os
from typing import Any, Tuple, List

import coremltools as ct
import numpy as np
# import Quartz
import scrypted_sdk
# from Foundation import NSData, NSMakeSize
from PIL import Image, ImageOps
from scrypted_sdk import (
    Setting,
    SettingValue,
    ObjectDetectionSession,
    ObjectsDetected,
    ObjectDetectionResult,
)
import traceback

# import Vision
from predict import Prediction, PredictPlugin, from_bounding_box
import yolo
import math

def softmax(X, theta = 1.0, axis = None):
    """
    Compute the softmax of each element along an axis of X.

    Parameters
    ----------
    X: ND-Array. Probably should be floats.
    theta (optional): float parameter, used as a multiplier
        prior to exponentiation. Default = 1.0
    axis (optional): axis to compute values along. Default is the
        first non-singleton axis.

    Returns an array the same size as X. The result will sum to 1
    along the specified axis.
    """

    # make X at least 2d
    y = np.atleast_2d(X)

    # find axis
    if axis is None:
        axis = next(j[0] for j in enumerate(y.shape) if j[1] > 1)

    # multiply y against the theta parameter,
    y = y * float(theta)

    # subtract the max for numerical stability
    y = y - np.expand_dims(np.max(y, axis = axis), axis)

    # exponentiate y
    y = np.exp(y)

    # take the sum along the specified axis
    ax_sum = np.expand_dims(np.sum(y, axis = axis), axis)

    # finally: divide elementwise
    p = y / ax_sum

    # flatten if X was 1D
    if len(X.shape) == 1: p = p.flatten()

    return p

def euclidean_distance(arr1, arr2):
    return np.linalg.norm(arr1 - arr2)


def cosine_similarity(vector_a, vector_b):
    dot_product = np.dot(vector_a, vector_b)
    norm_a = np.linalg.norm(vector_a)
    norm_b = np.linalg.norm(vector_b)
    similarity = dot_product / (norm_a * norm_b)
    return similarity


predictExecutor = concurrent.futures.ThreadPoolExecutor(8, "Vision-Predict")


class VisionPlugin(PredictPlugin):
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
        self.detectInput = self.detectModel.get_spec().description.input[0].name

        self.textModel = self.downloadModel("vgg_english_g2")
        self.textInput = self.textModel.get_spec().description.input[0].name

        self.faceModel = self.downloadModel("inception_resnet_v1")
        self.faceInput = self.faceModel.get_spec().description.input[0].name

    def downloadModel(self, model: str):
        model_version = "v7"
        mlmodel = "model"

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

        return ct.models.MLModel(modelFile)

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

    def predictVision(self, input: Image.Image) -> asyncio.Future[list[Prediction]]:
        buffer = input.tobytes()
        myData = NSData.alloc().initWithBytes_length_(buffer, len(buffer))

        input_image = (
            Quartz.CIImage.imageWithBitmapData_bytesPerRow_size_format_options_(
                myData,
                4 * input.width,
                NSMakeSize(input.width, input.height),
                Quartz.kCIFormatRGBA8,
                None,
            )
        )

        request_handler = Vision.VNImageRequestHandler.alloc().initWithCIImage_options_(
            input_image, None
        )

        loop = self.loop
        future = loop.create_future()

        def detect_face_handler(request, error):
            observations = request.results()
            if error:
                loop.call_soon_threadsafe(future.set_exception, Exception())
            else:
                objs = []
                for o in observations:
                    confidence = o.confidence()
                    bb = o.boundingBox()
                    origin = bb.origin
                    size = bb.size

                    l = origin.x * input.width
                    t = (1 - origin.y - size.height) * input.height
                    w = size.width * input.width
                    h = size.height * input.height
                    prediction = Prediction(
                        0, confidence, from_bounding_box((l, t, w, h))
                    )
                    objs.append(prediction)

                loop.call_soon_threadsafe(future.set_result, objs)

        request = (
            Vision.VNDetectFaceRectanglesRequest.alloc().initWithCompletionHandler_(
                detect_face_handler
            )
        )

        error = request_handler.performRequests_error_([request], None)
        return future

    # async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
    #     future = await asyncio.get_event_loop().run_in_executor(
    #         predictExecutor,
    #         lambda: self.predictVision(input),
    #     )

    #     objs = await future
    #     ret = self.create_detection_result(objs, src_size, cvss)
    #     return ret

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        out_dict = await asyncio.get_event_loop().run_in_executor(
            predictExecutor, lambda: self.detectModel.predict({self.detectInput: input})
        )
        results = list(out_dict.values())[0][0]
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

            out_dict = await asyncio.get_event_loop().run_in_executor(
                predictExecutor,
                lambda: self.faceModel.predict({self.faceInput: processed_tensor}),
            )

            output = out_dict["var_2167"][0]
            b = output.tobytes()
            embedding = str(base64.encodebytes(b))
            d["embedding"] = embedding
        except Exception as e:

            traceback.print_exc()
            pass

    async def setLabel(self, d: ObjectDetectionResult, image: scrypted_sdk.Image):
        try:
            new_height = 64
            new_width = int(d["boundingBox"][2] * new_height / d["boundingBox"][3])
            textImage = await crop(d, image, new_width, new_height, 'gray', "L")
            new_width = 256
            # calculate padding dimensions
            padding = (0, 0, new_width - textImage.width, 0)
            # todo: clamp entire edge rather than just center
            edge_color = textImage.getpixel((textImage.width - 1, textImage.height // 2))
            # pad image
            textImage = ImageOps.expand(textImage, padding, fill=edge_color)
            # pil to numpy
            image_array = np.array(textImage)
            image_array = image_array.reshape(textImage.height, textImage.width, 1)
            image_tensor = image_array.transpose((2, 0, 1)) / 255
            image_tensor = (image_tensor - 0.5) / 0.5

            image_tensor = np.expand_dims(image_tensor, axis=0)


            out_dict = self.textModel.predict({self.textInput: image_tensor})
            preds = out_dict["linear_2"]
            preds_size = preds.shape[1]

            # softmax preds using scipy
            preds_prob = softmax(preds, axis=2)
            # preds_prob = softmax(preds)
            pred_norm = np.sum(preds_prob, axis=2)
            preds_prob = preds_prob / np.expand_dims(pred_norm, axis=-1)

            preds_index = np.argmax(preds_prob, axis=2)
            preds_index = preds_index.reshape(-1)

            characters = "0123456789!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ €ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

            dict_character = list(characters)
            character = ["[blank]"] + dict_character  # dummy '[blank]' token for CTCLoss (index 0)

            def decode_greedy(text_index, length):
                """convert text-index into text-label."""
                texts = []
                index = 0
                for l in length:
                    t = text_index[index : index + l]
                    # Returns a boolean array where true is when the value is not repeated
                    a = np.insert(~((t[1:] == t[:-1])), 0, True)
                    # Returns a boolean array where true is when the value is not in the ignore_idx list
                    b = ~np.isin(t, np.array(""))
                    # Combine the two boolean array
                    c = a & b
                    # Gets the corresponding character according to the saved indexes
                    text = "".join(np.array(character)[t[c.nonzero()]])
                    texts.append(text)
                    index += l
                return texts

            preds_str = decode_greedy(preds_index, np.array([preds_size]))
            d['label'] = preds_str[0].replace('[blank]', '')

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

        return ret


async def crop(d: ObjectDetectionResult, image: scrypted_sdk.Image, width: int, height: int, format: str, pilFormat: str):
    l, t, w, h = d["boundingBox"]
    cropped = await image.toBuffer(
        {
            "crop": {
                "left": l,
                "top": t,
                "width": w,
                "height": h,
            },
            "resize": {
                "width": width,
                "height": height,
            },
            "format": format,
        }
    )
    pilImage = Image.frombuffer(pilFormat, (width, height), cropped)
    return pilImage
