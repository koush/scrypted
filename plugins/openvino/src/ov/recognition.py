from __future__ import annotations

import concurrent.futures
import openvino.runtime as ov

import numpy as np

from predict.recognize import RecognizeDetection


def euclidean_distance(arr1, arr2):
    return np.linalg.norm(arr1 - arr2)


def cosine_similarity(vector_a, vector_b):
    dot_product = np.dot(vector_a, vector_b)
    norm_a = np.linalg.norm(vector_a)
    norm_b = np.linalg.norm(vector_b)
    similarity = dot_product / (norm_a * norm_b)
    return similarity

class OpenVINORecognition(RecognizeDetection):
    def __init__(self, plugin, nativeId: str | None = None):
        self.plugin = plugin

        super().__init__(nativeId=nativeId)

    def downloadModel(self, model: str):
        ovmodel = "best"
        precision = self.plugin.precision
        model_version = "v5"
        xmlFile = self.downloadFile(
            f"https://raw.githubusercontent.com/koush/openvino-models/main/{model}/{precision}/{ovmodel}.xml",
            f"{model_version}/{model}/{precision}/{ovmodel}.xml",
        )
        binFile = self.downloadFile(
            f"https://raw.githubusercontent.com/koush/openvino-models/main/{model}/{precision}/{ovmodel}.bin",
            f"{model_version}/{model}/{precision}/{ovmodel}.bin",
        )
        print(xmlFile, binFile)
        return self.plugin.core.compile_model(xmlFile, self.plugin.mode)

    def predictDetectModel(self, input):
        infer_request = self.detectModel.create_infer_request()
        im = np.stack([input])
        im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
        im = im.astype(np.float32) / 255.0
        im = np.ascontiguousarray(im)  # contiguous
        im = ov.Tensor(array=im)
        input_tensor = im
        infer_request.set_input_tensor(input_tensor)
        infer_request.start_async()
        infer_request.wait()
        return infer_request.output_tensors[0].data[0]

    def predictFaceModel(self, input):
        im = ov.Tensor(array=input)
        infer_request = self.faceModel.create_infer_request()
        infer_request.set_input_tensor(im)
        infer_request.start_async()
        infer_request.wait()
        return infer_request.output_tensors[0].data[0]

    def predictTextModel(self, input):
        input = input.astype(np.float32)
        im = ov.Tensor(array=input)
        infer_request = self.textModel.create_infer_request()
        infer_request.set_input_tensor(im)
        infer_request.start_async()
        infer_request.wait()
        return infer_request.output_tensors[0].data
