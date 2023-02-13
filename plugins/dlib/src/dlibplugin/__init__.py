from __future__ import annotations
import re
import scrypted_sdk
from typing import Any, Tuple
from predict import PredictPlugin, Prediction, Rectangle
import os
from PIL import Image
import face_recognition
import numpy as np
from typing import Any, List, Tuple, Mapping
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected, Setting

MIME_TYPE = 'x-scrypted-dlib/x-raw-image'

class DlibPlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(MIME_TYPE, nativeId=nativeId)

        self.labels = {
           0: 'face'
        }

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        pass

    def get_input_size(self) -> Tuple[float, float]:
        pass

    def detect_once(self, input: Image.Image, settings: Any, src_size, cvss) -> ObjectsDetected:
        nparray = np.array(input)

        face_landmarks_list = face_recognition.face_landmarks(nparray)

        objs = []

        for face in face_landmarks_list:
            xmin: int = None
            xmax: int = None
            ymin: int = None
            ymax: int = None
            for feature in face:
                for point in face[feature]:
                    if xmin == None:
                        xmin = point[0]
                        ymin = point[1]
                        xmax = point[0]
                        ymax = point[1]
                    else:
                        xmin = min(xmin, point[0])
                        ymin = min(ymin, point[1])
                        xmax = max(xmax, point[0])
                        ymax = max(ymax, point[1])



            obj = Prediction(0, 1, Rectangle(
                xmin,
                ymin,
                xmax,
                ymax
            ))
            objs.append(obj)

        ret = self.create_detection_result(objs, src_size, ['face'], cvss)

        return ret
