from __future__ import annotations
import threading
from .common import *
from PIL import Image
from pycoral.adapters import detect
from pycoral.adapters.common import input_size
loaded_py_coral = False
try:
    from pycoral.utils.edgetpu import list_edge_tpus
    from pycoral.utils.edgetpu import make_interpreter
    loaded_py_coral = True
    print('coral edge tpu library loaded successfully')
except Exception as e:
    print('coral edge tpu library load failed', e)
    pass
import tflite_runtime.interpreter as tflite
import re
import scrypted_sdk
from scrypted_sdk.types import Setting
from typing import Any, Tuple
from predict import PredictPlugin

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


MIME_TYPE = 'x-scrypted-tensorflow-lite/x-raw-image'

class TensorFlowLitePlugin(PredictPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(MIME_TYPE, nativeId=nativeId)

        labels_contents = scrypted_sdk.zip.open(
            'fs/coco_labels.txt').read().decode('utf8')
        self.labels = parse_label_contents(labels_contents)
        try:
            edge_tpus = list_edge_tpus()
            print('edge tpus', edge_tpus)
            if not len(edge_tpus):
                raise Exception('no edge tpu found')
            self.edge_tpu_found = str(edge_tpus)
            # todo co-compile
            # https://coral.ai/docs/edgetpu/compiler/#co-compiling-multiple-models
            model = scrypted_sdk.zip.open(
                'fs/mobilenet_ssd_v2_coco_quant_postprocess_edgetpu.tflite').read()
            # face_model = scrypted_sdk.zip.open(
            #     'fs/mobilenet_ssd_v2_face_quant_postprocess.tflite').read()
            self.interpreter = make_interpreter(model)
            # self.face_interpreter = make_interpreter(face_model)
        except Exception as e:
            print('unable to use Coral Edge TPU', e)
            self.edge_tpu_found = 'Edge TPU not found'
            model = scrypted_sdk.zip.open(
                'fs/mobilenet_ssd_v2_coco_quant_postprocess.tflite').read()
            # face_model = scrypted_sdk.zip.open(
            #     'fs/mobilenet_ssd_v2_face_quant_postprocess.tflite').read()
            self.interpreter = tflite.Interpreter(model_content=model)
            # self.face_interpreter = make_interpreter(face_model)
        self.interpreter.allocate_tensors()
        self.mutex = threading.Lock()

    async def getSettings(self) -> list[Setting]:
        ret = await super().getSettings()
        coral: Setting = {
            'title': 'Detected Edge TPU',
            'description': 'The device paths of the Coral Edge TPUs that will be used for detections.',
            'value': self.edge_tpu_found,
            'readonly': True,
            'key': 'coral',
        }

        ret.append(coral)

        return ret

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        with self.mutex:
            _, height, width, channels = self.interpreter.get_input_details()[
                0]['shape']
            return int(width), int(height), int(channels)

    def get_input_size(self) -> Tuple[float, float]:
        return input_size(self.interpreter)

    def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        with self.mutex:
            common.set_input(
                self.interpreter, input)
            scale = (1, 1)
            # _, scale = common.set_resized_input(
            #     self.interpreter, cropped.size, lambda size: cropped.resize(size, Image.ANTIALIAS))
            self.interpreter.invoke()
            objs = detect.get_objects(
                self.interpreter, score_threshold=.2, image_scale=scale)

        allowList = settings.get('allowList', None) if settings else None
        ret = self.create_detection_result(objs, src_size, allowList, cvss)
        return ret
