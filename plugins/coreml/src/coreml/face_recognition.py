from __future__ import annotations

import concurrent.futures
import os

import asyncio
import coremltools as ct
import numpy as np
# import Quartz
# from Foundation import NSData, NSMakeSize

# import Vision
from predict.face_recognize import FaceRecognizeDetection
from PIL import Image


def euclidean_distance(arr1, arr2):
    return np.linalg.norm(arr1 - arr2)


def cosine_similarity(vector_a, vector_b):
    dot_product = np.dot(vector_a, vector_b)
    norm_a = np.linalg.norm(vector_a)
    norm_b = np.linalg.norm(vector_b)
    similarity = dot_product / (norm_a * norm_b)
    return similarity


predictExecutor = concurrent.futures.ThreadPoolExecutor(8, "Vision-Predict")

class CoreMLFaceRecognition(FaceRecognizeDetection):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin, nativeId)
        self.detectExecutor = concurrent.futures.ThreadPoolExecutor(1, "detect-face")
        self.recogExecutor = concurrent.futures.ThreadPoolExecutor(1, "recog-face")

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

        model = ct.models.MLModel(modelFile)
        inputName = model.get_spec().description.input[0].name
        return model, inputName
    
    async def predictDetectModel(self, input: Image.Image):
        def predict():
            model, inputName = self.detectModel
            out_dict = model.predict({inputName: input})
            results = list(out_dict.values())[0][0]
            return results

        results = await asyncio.get_event_loop().run_in_executor(
            self.detectExecutor, lambda: predict()
        )
        return results

    async def predictFaceModel(self, input: np.ndarray):
        def predict():
            model, inputName = self.faceModel
            out_dict = model.predict({inputName: input})
            results = list(out_dict.values())[0][0]
            return results
        results = await asyncio.get_event_loop().run_in_executor(
            self.recogExecutor, lambda: predict()
        )
        return results
    
    # def predictVision(self, input: Image.Image) -> asyncio.Future[list[Prediction]]:
    #     buffer = input.tobytes()
    #     myData = NSData.alloc().initWithBytes_length_(buffer, len(buffer))

    #     input_image = (
    #         Quartz.CIImage.imageWithBitmapData_bytesPerRow_size_format_options_(
    #             myData,
    #             4 * input.width,
    #             NSMakeSize(input.width, input.height),
    #             Quartz.kCIFormatRGBA8,
    #             None,
    #         )
    #     )

    #     request_handler = Vision.VNImageRequestHandler.alloc().initWithCIImage_options_(
    #         input_image, None
    #     )

    #     loop = self.loop
    #     future = loop.create_future()

    #     def detect_face_handler(request, error):
    #         observations = request.results()
    #         if error:
    #             loop.call_soon_threadsafe(future.set_exception, Exception())
    #         else:
    #             objs = []
    #             for o in observations:
    #                 confidence = o.confidence()
    #                 bb = o.boundingBox()
    #                 origin = bb.origin
    #                 size = bb.size

    #                 l = origin.x * input.width
    #                 t = (1 - origin.y - size.height) * input.height
    #                 w = size.width * input.width
    #                 h = size.height * input.height
    #                 prediction = Prediction(
    #                     0, confidence, from_bounding_box((l, t, w, h))
    #                 )
    #                 objs.append(prediction)

    #             loop.call_soon_threadsafe(future.set_result, objs)

    #     request = (
    #         Vision.VNDetectFaceRectanglesRequest.alloc().initWithCompletionHandler_(
    #             detect_face_handler
    #         )
    #     )

    #     error = request_handler.performRequests_error_([request], None)
    #     return future

    # async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
    #     future = await asyncio.get_event_loop().run_in_executor(
    #         predictExecutor,
    #         lambda: self.predictVision(input),
    #     )

    #     objs = await future
    #     ret = self.create_detection_result(objs, src_size, cvss)
    #     return ret
