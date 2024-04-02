from __future__ import annotations

import asyncio
import concurrent.futures
import os
from typing import Any, Tuple

import coremltools as ct
import Quartz
import scrypted_sdk
from Foundation import NSData, NSMakeSize
from PIL import Image, ImageOps
from scrypted_sdk import Setting, SettingValue

import Vision
from predict import Prediction, PredictPlugin, from_bounding_box

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

        model_version = "v1"
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
                loop.call_soon_threadsafe(future.set_result, observations)

        request = (
            Vision.VNDetectFaceRectanglesRequest.alloc().initWithCompletionHandler_(
                detect_face_handler
            )
        )

        error = request_handler.performRequests_error_([request], None)
        return future

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        if asyncio.get_event_loop() is self.loop:
            future = await asyncio.get_event_loop().run_in_executor(
                predictExecutor,
                lambda: self.predictVision(input),
            )
        else:
            future = await self.predictVision(input)

        observations = await future

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

            face = input.crop((l, t, l + w, t + h)).convert('RGB')

            if face.width > face.height:
                scale = 160 / face.width
                face = face.resize((160, int(face.height * scale)))
                if face.height < 160:
                    face = ImageOps.expand(face, border=((0, 160 - face.height)), fill='black')
            else:
                scale = 160 / face.height
                face = face.resize((int(face.width * scale), 160))
                if face.width < 160:
                    face = ImageOps.expand(face, border=((160 - face.width, 0)), fill='black')

            descriptor = self.model.predict({"x_1": face})

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
