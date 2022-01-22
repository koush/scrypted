from __future__ import annotations
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected, Setting
import threading
import io
from .common import *
from PIL import Image
from pycoral.adapters import detect
from pycoral.adapters.common import input_size
from pycoral.utils.edgetpu import run_inference
from pycoral.utils.edgetpu import list_edge_tpus
from pycoral.utils.edgetpu import make_interpreter
import tflite_runtime.interpreter as tflite
import re
import scrypted_sdk
from typing import Any, List

from detect import DetectionSession, DetectPlugin


class TensorFlowLiteSession(DetectionSession):
    def __init__(self) -> None:
        super().__init__()


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


defaultThreshold = .4


class TensorFlowLitePlugin(DetectPlugin):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)
        labels_contents = scrypted_sdk.zip.open(
            'fs/coco_labels.txt').read().decode('utf8')
        self.labels = parse_label_contents(labels_contents)
        edge_tpus = list_edge_tpus()
        print('edge tpu', edge_tpus)
        if len(edge_tpus):
            model = scrypted_sdk.zip.open(
                'fs/mobilenet_ssd_v2_coco_quant_postprocess_edgetpu.tflite').read()
            self.interpreter = make_interpreter(model)
        else:
            model = scrypted_sdk.zip.open(
                'fs/mobilenet_ssd_v2_coco_quant_postprocess.tflite').read()
            self.interpreter = tflite.Interpreter(model_content=model)
        self.interpreter.allocate_tensors()
        self.mutex = threading.Lock()

    async def getDetectionModel(self) -> ObjectDetectionModel:
        _, height, width, channels = self.interpreter.get_input_details()[
            0]['shape']

        d: ObjectDetectionModel = {
            'name': '@scrypted/tensorflow-lite',
            'classes': list(self.labels.values()),
            'inputSize': [int(width), int(height), int(channels)],
        }
        setting: Setting = {
            'title': 'Minimum Detection Confidence',
            'description': 'Higher values eliminate false positives and low quality recognition candidates.',
            'key': 'score_threshold',
            'type': 'number',
            'value': defaultThreshold,
            'placeholder': defaultThreshold,
        }
        d['settings'] = [setting]
        return d

    def create_detection_result(self, objs, size, convert_to_src_size=None):
        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = size

        for obj in objs:
            detection: ObjectDetectionResult = {}
            detection['boundingBox'] = (
                obj.bbox.xmin, obj.bbox.ymin, obj.bbox.xmax - obj.bbox.xmin, obj.bbox.ymax - obj.bbox.ymin)
            detection['className'] = self.labels.get(obj.id, obj.id)
            detection['score'] = obj.score
            detections.append(detection)

        if convert_to_src_size:
            detections = detection_result['detections']
            detection_result['detections'] = []
            for detection in detections:
                bb = detection['boundingBox']
                x, y, valid = convert_to_src_size((bb[0], bb[1]), True)
                x2, y2, valid2 = convert_to_src_size((bb[0] + bb[2], bb[1] + bb[3]), True)
                if not valid or not valid2:
                    # print("filtering out", detection['className'])
                    continue
                detection['boundingBox'] = (x, y, x2 - x + 1, y2 - y + 1)
                detection_result['detections'].append(detection)

        # print(detection_result)
        return detection_result

    def parse_settings(self, settings: Any):
        score_threshold = .4
        if settings:
            score_threshold = float(settings.get(
                'score_threshold', score_threshold))
        return score_threshold

    def run_detection_jpeg(self, detection_session: TensorFlowLiteSession, image_bytes: bytes, settings: Any) -> ObjectsDetected:
        stream = io.BytesIO(image_bytes)
        image = Image.open(stream)

        _, scale = common.set_resized_input(
            self.interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))

        score_threshold = self.parse_settings(settings)
        with self.mutex:
            self.interpreter.invoke()
            objs = detect.get_objects(
                self.interpreter, score_threshold=score_threshold, image_scale=scale)

        return self.create_detection_result(objs, image.size)

    def get_detection_input_size(self, src_size):
        return input_size(self.interpreter)

    def run_detection_gstsample(self, detection_session: TensorFlowLiteSession, gstsample, settings: Any, src_size, convert_to_src_size) -> ObjectsDetected:
        score_threshold = self.parse_settings(settings)

        gst_buffer = gstsample.get_buffer()
        with self.mutex:
            run_inference(self.interpreter, gst_buffer)
            objs = detect.get_objects(
                self.interpreter, score_threshold=score_threshold)

        return self.create_detection_result(objs, src_size, convert_to_src_size)

    def create_detection_session(self):
        return TensorFlowLiteSession()
