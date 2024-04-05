from __future__ import annotations

import asyncio
from asyncio import Future
import base64
import concurrent.futures
import os
from typing import Any, Tuple, List

import coremltools as ct
import numpy as np
import Quartz
import scrypted_sdk
from Foundation import NSData, NSMakeSize
from PIL import Image, ImageOps
from scrypted_sdk import (
    Setting,
    SettingValue,
    ObjectDetectionSession,
    ObjectsDetected,
    ObjectDetectionResult,
)

import Vision
from predict import Prediction, PredictPlugin, from_bounding_box


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

        self.inputheight = None
        self.inputwidth = None

        self.labels = {
            0: "face",
        }
        self.loop = asyncio.get_event_loop()
        self.minThreshold = 0.2

        model_version = "v2"
        model = "inception_resnet_v1"
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

        self.model = ct.models.MLModel(modelFile)

        self.modelspec = self.model.get_spec()
        self.inputdesc = self.modelspec.description.input[0]
        self.inputwidthResnet = self.inputdesc.type.imageType.width
        self.inputheightResnet = self.inputdesc.type.imageType.height

    async def getSettings(self) -> list[Setting]:
        pass

    async def putSetting(self, key: str, value: SettingValue):
        self.storage.setItem(key, value)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        await scrypted_sdk.deviceManager.requestRestart()

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 4)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def get_input_format(self) -> str:
        return "rgba"

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
                    prediction = Prediction(0, confidence, from_bounding_box((l, t, w, h)))
                    objs.append(prediction)

                loop.call_soon_threadsafe(future.set_result, objs)

        request = (
            Vision.VNDetectFaceRectanglesRequest.alloc().initWithCompletionHandler_(
                detect_face_handler
            )
        )

        error = request_handler.performRequests_error_([request], None)
        return future

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        future = await asyncio.get_event_loop().run_in_executor(
            predictExecutor,
            lambda: self.predictVision(input),
        )

        objs = await future
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
                lambda: self.model.predict({"x_1": processed_tensor}),
            )

            output = out_dict["var_2167"][0]
            b = output.tobytes()
            embedding = str(base64.encodebytes(b))
            d["embedding"] = embedding
        except Exception as e:
            import traceback
            traceback.print_exc()
            pass

    async def run_detection_image(
        self, image: scrypted_sdk.Image, detection_session: ObjectDetectionSession
    ) -> ObjectsDetected:
        ret = await super().run_detection_image(image, detection_session)

        futures: List[Future] = []

        for d in ret["detections"]:
            if d["score"] < 0.7:
                continue

            futures.append(asyncio.ensure_future(self.setEmbedding(d, image)))

        await asyncio.wait(futures)

        return ret
