from __future__ import annotations

import concurrent.futures
import os

import asyncio

import coremltools as ct
import numpy as np
from PIL import Image

from predict.text_recognize import TextRecognition


class CoreMLTextRecognition(TextRecognition):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin, nativeId)

        self.detectExecutor = concurrent.futures.ThreadPoolExecutor(1, "detect-text")
        self.recogExecutor = concurrent.futures.ThreadPoolExecutor(1, "recog-text")

    def downloadModel(self, model: str):
        model_path = self.downloadHuggingFaceModelLocalFallback(model)
        modelFile = os.path.join(model_path, f"{model}.mlpackage")
        model = ct.models.MLModel(modelFile)
        inputName = model.get_spec().description.input[0].name
        return model, inputName

    async def predictDetectModel(self, input: Image.Image):
        def predict():
            model, inputName = self.detectModel
            out_dict = model.predict({inputName: input})
            results = list(out_dict.values())[0]
            return results
        results = await asyncio.get_event_loop().run_in_executor(
            self.detectExecutor, lambda: predict()
        )
        return results

    async def predictTextModel(self, input: np.ndarray):
        def predict():
            model, inputName = self.textModel
            out_dict = model.predict({inputName: input})
            preds = out_dict["linear_2"]
            return preds
        preds = await asyncio.get_event_loop().run_in_executor(
            self.recogExecutor, lambda: predict()
        )
        return preds
