from __future__ import annotations

import os

import coremltools as ct

from predict.text_recognize import TextRecognition


class CoreMLTextRecognition(TextRecognition):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

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

    def predictDetectModel(self, input):
        model, inputName = self.detectModel
        out_dict = model.predict({inputName: input})
        results = list(out_dict.values())[0]
        return results

    def predictTextModel(self, input):
        model, inputName = self.textModel
        out_dict = model.predict({inputName: input})
        preds = out_dict["linear_2"]
        return preds
