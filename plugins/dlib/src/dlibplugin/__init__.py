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
import threading
import asyncio
import base64
import json
import random
import string
from scrypted_sdk import RequestPictureOptions, MediaObject, Setting
import os
import json

def random_string():
    letters = string.ascii_lowercase
    return ''.join(random.choice(letters) for i in range(10))


MIME_TYPE = 'x-scrypted-dlib/x-raw-image'

class DlibPlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(MIME_TYPE, nativeId=nativeId)

        self.labels = {
           0: 'face'
        }

        self.mutex = threading.Lock()
        self.known_faces = {}
        self.encoded_faces = {}
        self.load_known_faces()

    def save_known_faces(self):
        j = json.dumps(self.known_faces)
        self.storage.setItem('known', j)

    def load_known_faces(self):
        self.known_faces = {}
        self.encoded_faces = {}

        try:
            self.known_faces = json.loads(self.storage.getItem('known'))
        except:
            pass

        for known in self.known_faces:
            encoded = []
            self.encoded_faces[known] = encoded
            encodings = self.known_faces[known]
            for str in encodings:
                try:
                        parsed = base64.decodebytes(bytes(str, 'utf-8'))
                        encoding = np.frombuffer(parsed, dtype=np.float64)
                        encoded.append(encoding)
                except:
                    pass

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        pass

    def get_input_size(self) -> Tuple[float, float]:
        pass

    def getTriggerClasses(self) -> list[str]:
        return ['person']

    def detect_once(self, input: Image.Image, settings: Any, src_size, cvss) -> ObjectsDetected:
        nparray = np.array(input.resize((int(input.width / 4), int(input.height / 4))))

        with self.mutex:
            face_locations = face_recognition.face_locations(nparray)

        for idx, face in enumerate(face_locations):
            t, r, b, l = face
            t *= 4
            r *= 4
            b *= 4
            l *= 4
            face_locations[idx] = (t, r, b, l)

        nparray = np.array(input)

        with self.mutex:
            face_encodings = face_recognition.face_encodings(nparray, face_locations)

        all_ids = []
        all_faces = []
        for encoded in self.encoded_faces:
            all_ids += ([encoded] * len(self.encoded_faces[encoded]))
            all_faces += self.encoded_faces[encoded]

        m = {}
        for idx, fe in enumerate(face_encodings):
            results = list(face_recognition.face_distance(all_faces, fe))

            best = 1
            if len(results):
                best = min(results)
                minpos = results.index(best)

            if best > .6:
                id = random_string() + '.jpg'
                print('top face %s' % best)
                print('new face %s' % id)
                encoded = [fe]
                self.encoded_faces[id] = encoded
                all_faces += encoded

                volume = os.environ['SCRYPTED_PLUGIN_VOLUME']
                people = os.path.join(volume, 'unknown')
                os.makedirs(people, exist_ok=True)
                t, r, b, l = face_locations[idx]
                cropped = input.crop((l, t, r, b))
                fp = os.path.join(people, id)
                cropped.save(fp)
            else:
                id = all_ids[minpos]
                print('has face %s' % id)

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


    async def takePicture(self, options: RequestPictureOptions = None) -> MediaObject:
        volume = os.environ['SCRYPTED_PLUGIN_VOLUME']
        people = os.path.join(volume, 'unknown')
        os.makedirs(people, exist_ok=True)
        for unknown in os.listdir(people):
            fp = os.path.join(people, unknown)
            ret = scrypted_sdk.mediaManager.createMediaObjectFromUrl('file:/' + fp)
            return await ret

        black = os.path.join(volume, 'zip', 'unzipped', 'fs', 'black.jpg')
        ret = scrypted_sdk.mediaManager.createMediaObjectFromUrl('file:/' + black)
        return await ret

    async def getSettings(self) -> list[Setting]:
        ret = []

        volume = os.environ['SCRYPTED_PLUGIN_VOLUME']
        people = os.path.join(volume, 'unknown')
        os.makedirs(people, exist_ok=True)

        choices = list(self.known_faces.keys())

        for unknown in os.listdir(people):
            ret.append(
                {
                    'key': unknown,
                    'title': 'Name',
                    'description': 'Associate this thumbnail with an existing person or identify a new person.',
                    'choices': choices,
                    'combobox': True,
                }
            )
            ret.append(
                {
                    'key': 'delete',
                    'title': 'Delete',
                    'description': 'Delete this face.',
                    'type': 'button',
                }
            )
            break

        if not len(ret):
            ret.append(
                {
                    'key': 'unknown',
                    'title': 'Unknown People',
                    'value': 'Waiting for unknown person...',
                    'description': 'There are no more people that need to be identified.',
                    'readonly': True,
                }
            )


        ret.append(
            {
                'key': 'known',
                'group': 'People',
                'title': 'Familiar People',
                'description': 'The people known to this plugin.',
                'choices': choices,
                'multiple': True,
                'value': choices,
            }
        )

        return ret

    async def putSetting(self, key: str, value: str) -> None:
        if key == 'known':
            n = {}
            for k in value:
                n[k] = self.known_faces[k]
            self.known_faces = n
            self.save_known_faces()
        elif value or key == 'delete':
            volume = os.environ['SCRYPTED_PLUGIN_VOLUME']
            people = os.path.join(volume, 'unknown')
            os.makedirs(people, exist_ok=True)
            for unknown in os.listdir(people):
                fp = os.path.join(people, unknown)
                os.remove(fp)
                if key != 'delete':
                    encoded = self.encoded_faces[key]
                    strs = []
                    for e in encoded:
                        strs.append(base64.encodebytes(e.tobytes()).decode())
                    if not self.known_faces.get(value):
                        self.known_faces[value] = []
                    self.known_faces[value] += strs
                    self.save_known_faces()
                break

        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Camera.value, None)