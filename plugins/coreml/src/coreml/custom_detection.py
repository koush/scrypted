from __future__ import annotations

import asyncio
import concurrent.futures
import os

import coremltools as ct
import numpy as np
import scrypted_sdk
from PIL import Image

from predict.custom_detect import CustomDetection


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
    
    async def predictModel(self, input: Image.Image) -> scrypted_sdk.ObjectsDetected:
        model, inputName = self.model
        def predict():
            if self.model_config.get("mean", None) and self.model_config.get("std", None):
                im = np.array(input)
                im = im.astype(np.float32) / 255.0

                mean = np.array(self.model_config.get("mean", None), dtype=np.float32)
                std = np.array(self.model_config.get("std", None), dtype=np.float32)
                im = (im - mean) / std

                # Convert HWC to CHW
                im = im.transpose(2, 0, 1)  # Channels first
                im = im.astype(np.float32)
                im = np.ascontiguousarray(im)
                im = np.expand_dims(im, axis=0)

                out_dict = model.predict({inputName: im})
            else:
                out_dict = model.predict({inputName: input})

            results = list(out_dict.values())[0][0]
            return results

        results = await asyncio.get_event_loop().run_in_executor(
            self.detectExecutor, lambda: predict()
        )
        return results
