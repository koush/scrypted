from __future__ import annotations

import asyncio
import concurrent.futures
from typing import Any, Tuple

import Quartz
import scrypted_sdk
from Foundation import NSData, NSMakeSize
from PIL import Image
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
            # print(confidence, origin.x, origin.y, size.width, size.height)
            prediction = Prediction(
                0,
                confidence,
                from_bounding_box(
                    (
                        origin.x * input.width,
                        (1 - origin.y - size.height) * input.height,
                        size.width * input.width,
                        size.height * input.height,
                    )
                ),
            )
            objs.append(prediction)

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
