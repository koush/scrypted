from __future__ import annotations

import asyncio

import numpy as np
from PIL import Image
import os
import coremltools as ct


from predict.custom_detect import CustomDetection
from scrypted_sdk import ObjectsDetected
import concurrent.futures


class CoreMLCustomDetection(CustomDetection):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)
        self.prefer_relu = True
        self.detectExecutor = concurrent.futures.ThreadPoolExecutor(1, "detect-custom")

    def loadModel(self, files: list[str]):
        # find the xml file in the files list
        manifest_files = [f for f in files if f.lower().endswith('manifest.json')]
        if not manifest_files:
            raise ValueError("No Manifest.json file found in the provided files list")
        manifest_file = manifest_files[0]
        modelFile = os.path.dirname(manifest_file)

        model = ct.models.MLModel(modelFile)
        inputName = model.get_spec().description.input[0].name
        return model, inputName
    
    async def predictModel(self, input: Image.Image) -> ObjectsDetected:
        def predict():
            if self.model_config.get("mean", None) and self.model_config.get("std", None):
                model, inputName = self.model
                im = np.expand_dims(input, axis=0)
                im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
                im = im.astype(np.float32) / 255.0

                mean = np.array(self.model_config["mean"])
                std = np.array(self.model_config["std"])
                mean = mean.reshape(1, -1, 1, 1)
                std = std.reshape(1, -1, 1, 1)
                im = (im - mean) / std
                im = im.astype(np.float32)

                im = np.ascontiguousarray(im)

                out_dict = model.predict({inputName: im})
            else:
                out_dict = self.model.predict({self.inputName: input})

            results = list(out_dict.values())[0][0]
            return results

        results = await asyncio.get_event_loop().run_in_executor(
            self.detectExecutor, lambda: predict()
        )
        return results
