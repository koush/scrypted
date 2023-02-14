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
from predict import PredictSession

MIME_TYPE = 'x-scrypted-dlib/x-raw-image'

class DlibPlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(MIME_TYPE, nativeId=nativeId)

        self.labels = {
           0: 'face'
        }

        self.known_faces = []

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        pass

    def get_input_size(self) -> Tuple[float, float]:
        pass

    def getTriggerClasses(self) -> list[str]:
        return ['person']

    def detect_once(self, input: Image.Image, settings: Any, src_size, cvss) -> ObjectsDetected:
        nparray = np.array(input.resize((int(input.width / 4), int(input.height / 4))))

        face_locations = face_recognition.face_locations(nparray)

        scaled = []
        for idx, face in enumerate(face_locations):
            t, r, b, l = face
            t *= 4
            r *= 4
            b *= 4
            l *= 4
            face_locations[idx] = (t, r, b, l)

        nparray = np.array(input)
        face_encodings = face_recognition.face_encodings(nparray, face_locations, model = 'small')

        m = {}
        for idx, fe in enumerate(face_encodings):
            results = face_recognition.compare_faces(self.known_faces, fe)
            found = False
            for i, r in enumerate(results):
                if r:
                    found = True
                    m[idx] = str(i)
                    break

            if not found:
                self.known_faces.append(fe)

        # return

        objs = []

        for face in face_locations:
            t, r, b, l = face
            obj = Prediction(0, 1, Rectangle(
                l,
                t,
                r,
                b
            ))
            objs.append(obj)

        ret = self.create_detection_result(objs, src_size, ['face'], cvss)

        for idx, d in enumerate(ret['detections']):
            d['id'] = m.get(idx)

        return ret

    def track(self, detection_session: PredictSession, ret: ObjectsDetected):
        pass

