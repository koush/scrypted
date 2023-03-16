from __future__ import annotations
import re
import scrypted_sdk
from typing import Any, Tuple
from predict import PredictPlugin, Prediction, Rectangle
import coremltools as ct
import os
from PIL import Image
import asyncio
import concurrent.futures

predictExecutor = concurrent.futures.ThreadPoolExecutor(2, "CoreML-Predict")

def parse_label_contents(contents: str):
    lines = contents.splitlines()
    ret = {}
    for row_number, content in enumerate(lines):
        pair = re.split(r'[:\s]+', content.strip(), maxsplit=1)
        if len(pair) == 2 and pair[0].strip().isdigit():
            ret[int(pair[0])] = pair[1].strip()
        else:
            ret[row_number] = content.strip()
    return ret


MIME_TYPE = 'x-scrypted-coreml/x-raw-image'

class CoreMLPlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(MIME_TYPE, nativeId=nativeId)

        modelPath = os.path.join(os.environ['SCRYPTED_PLUGIN_VOLUME'], 'zip', 'unzipped', 'fs', 'MobileNetV2_SSDLite.mlmodel')
        self.model = ct.models.MLModel(modelPath)
        
        self.modelspec = self.model.get_spec()
        self.inputdesc = self.modelspec.description.input[0]
        self.inputheight = self.inputdesc.type.imageType.height
        self.inputwidth = self.inputdesc.type.imageType.width

        labels_contents = scrypted_sdk.zip.open(
            'fs/coco_labels.txt').read().decode('utf8')
        self.labels = parse_label_contents(labels_contents)
        self.loop = asyncio.get_event_loop()

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        # run in executor if this is the plugin loop
        if asyncio.get_event_loop() is self.loop:
            out_dict = await asyncio.get_event_loop().run_in_executor(predictExecutor, lambda: self.model.predict({'image': input, 'confidenceThreshold': .2 }))
        else:
            out_dict = self.model.predict({'image': input, 'confidenceThreshold': .2 })

        coordinatesList = out_dict['coordinates']

        objs = []

        for index, confidenceList in enumerate(out_dict['confidence']):
            values = confidenceList
            maxConfidenceIndex = max(range(len(values)), key=values.__getitem__)
            maxConfidence = confidenceList[maxConfidenceIndex]
            if maxConfidence < .2:
                continue

            coordinates = coordinatesList[index]

            def torelative(value: float):
                return value * self.inputheight

            x = torelative(coordinates[0])
            y = torelative(coordinates[1])
            w = torelative(coordinates[2])
            h = torelative(coordinates[3])
            w2 = w / 2
            h2 = h / 2
            l = x - w2
            t = y - h2

            obj = Prediction(maxConfidenceIndex, maxConfidence, Rectangle(
                l,
                t,
                l + w,
                t + h
            ))
            objs.append(obj)

        allowList = settings.get('allowList', None) if settings else None
        ret = self.create_detection_result(objs, src_size, allowList, cvss)
        return ret
