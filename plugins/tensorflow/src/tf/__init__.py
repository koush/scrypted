from __future__ import annotations
import re
import scrypted_sdk
from typing import Any, Tuple
from predict import PredictPlugin, Prediction, Rectangle
import tensorflow as tf
import os
from PIL import Image
import numpy as np

print("Num GPUs Available: ", len(tf.config.list_physical_devices('GPU')))

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


MIME_TYPE = 'x-scrypted-tensorflow/x-raw-image'

class TensorFlowPlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(MIME_TYPE, nativeId=nativeId)

        modelPath = os.path.join(os.environ['SCRYPTED_PLUGIN_VOLUME'], 'zip', 'unzipped', 'fs')
        self.model = tf.saved_model.load(modelPath)
        self.model = self.model.signatures['serving_default']
        # self.model = hub.load("https://tfhub.dev/tensorflow/ssd_mobilenet_v2/2")

        self.inputheight = 320
        self.inputwidth = 320

        labels_contents = scrypted_sdk.zip.open(
            'fs/coco_labels.txt').read().decode('utf8')
        self.labels = parse_label_contents(labels_contents)

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        image_array  = tf.keras.utils.img_to_array(input)
        
        input_tensor = tf.convert_to_tensor(image_array, dtype = tf.uint8)
        input_tensor = input_tensor[tf.newaxis,...]

        detections = self.model(input_tensor)
        num_detections = int(detections.pop('num_detections'))
        detections = {key: value[0, :num_detections].numpy()
                    for key, value in detections.items()}
        detections['num_detections'] = num_detections
        # detection_classes should be ints.
        detections['detection_classes'] = detections['detection_classes'].astype(np.int64)
   
        objs = []

        for index, confidence in enumerate(detections['detection_scores']):
            confidence = confidence.astype(float)
            if confidence < .2:
                continue

            coordinates = detections['detection_boxes'][index]

            def torelative(value: np.float32):
                return value.astype(float) * self.inputheight

            t = torelative(coordinates[0])
            l = torelative(coordinates[1])
            b = torelative(coordinates[2])
            r = torelative(coordinates[3])

            obj = Prediction(detections['detection_classes'][index].astype(float) - 1, confidence, Rectangle(
                l,
                t,
                r,
                b
            ))
            objs.append(obj)

        allowList = settings.get('allowList', None) if settings else None
        ret = self.create_detection_result(objs, src_size, allowList, cvss)
        return ret
