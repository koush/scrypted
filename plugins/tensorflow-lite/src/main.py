from __future__ import annotations

import matplotlib

from detect import DetectionSession, DetectPlugin
matplotlib.use('Agg')

from typing import List
import scrypted_sdk
import numpy as np
import re
import tflite_runtime.interpreter as tflite
from pycoral.utils.edgetpu import make_interpreter
from pycoral.utils.edgetpu import list_edge_tpus
from pycoral.utils.edgetpu import run_inference
from pycoral.adapters.common import input_size
from pycoral.adapters import detect
from PIL import Image
import common
import io
import multiprocessing
from third_party.sort import Sort
from detect.safe_set_result import safe_set_result
import asyncio

from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected

class TrackerDetectionSession(DetectionSession):
    def __init__(self) -> None:
        super().__init__()
        self.tracker = Sort()

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

class CoralPlugin(DetectPlugin):
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
        self.mutex = multiprocessing.Lock()

    async def getInferenceModels(self) -> list[ObjectDetectionModel]:
        ret: List[ObjectDetectionModel] = []
        _, height, width, channels = self.interpreter.get_input_details()[
            0]['shape']

        d = {
            'id': 'mobilenet_ssd_v2_coco_quant_postprocess_edgetpu',
            'name': 'Coco SSD',
            'classes': list(self.labels.values()),
            'inputShape': [int(width), int(height), int(channels)],
        }
        ret.append(d)
        return ret

    def create_detection_result(self, objs, size, tracker: Sort = None):
        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = size

        tracker_detections = []

        for obj in objs:
            element = []
            element.append(obj.bbox.xmin)
            element.append(obj.bbox.ymin)
            element.append(obj.bbox.xmax)
            element.append(obj.bbox.ymax)
            element.append(obj.score)
            tracker_detections.append(element)

        tracker_detections = np.array(tracker_detections)
        trdata = []
        trackerFlag = False
        if tracker and tracker_detections.any():
            trdata = tracker.update(tracker_detections)
            trackerFlag = True

        if trackerFlag and (np.array(trdata)).size:
            for td in trdata:
                x0, y0, x1, y1, trackID = td[0].item(), td[1].item(
                ), td[2].item(), td[3].item(), td[4].item()
                overlap = 0
                for ob in objs:
                    dx0, dy0, dx1, dy1 = ob.bbox.xmin, ob.bbox.ymin, ob.bbox.xmax, ob.bbox.ymax
                    area = (min(dx1, x1)-max(dx0, x0)) * \
                        (min(dy1, y1)-max(dy0, y0))
                    if (area > overlap):
                        overlap = area
                        obj = ob

                detection: ObjectDetectionResult = {}
                detection['id'] = str(trackID)
                detection['boundingBox'] = (
                    obj.bbox.xmin, obj.bbox.ymin, obj.bbox.xmax - obj.bbox.xmin, obj.bbox.ymax - obj.bbox.ymin)
                detection['className'] = self.labels.get(obj.id, obj.id)
                detection['score'] = obj.score
                detections.append(detection)
        else:
            for obj in objs:
                detection: ObjectDetectionResult = {}
                detection['boundingBox'] = (
                    obj.bbox.xmin, obj.bbox.ymin, obj.bbox.xmax - obj.bbox.xmin, obj.bbox.ymax - obj.bbox.ymin)
                detection['className'] = self.labels.get(obj.id, obj.id)
                detection['score'] = obj.score
                detections.append(detection)

        return detection_result

    def run_detection_jpeg(self, detection_session: TrackerDetectionSession, image_bytes: bytes, min_score: float) -> ObjectsDetected:
        stream = io.BytesIO(image_bytes)
        image = Image.open(stream)

        _, scale = common.set_resized_input(
            self.interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))

        tracker = None
        if detection_session:
            tracker = detection_session.tracker

        with self.mutex:
            self.interpreter.invoke()
            objs = detect.get_objects(
                self.interpreter, score_threshold=min_score or -float('inf'), image_scale=scale)

        return self.create_detection_result(objs, image.size, tracker=tracker)

    def get_detection_input_size(self, src_size):
        return input_size(self.interpreter)

    def run_detection_gstsample(self, detection_session: TrackerDetectionSession, gstsample, min_score: float, src_size, inference_box, scale)-> ObjectsDetected:
        gst_buffer = gstsample.get_buffer()
        with self.mutex:
            run_inference(self.interpreter, gst_buffer)
            objs = detect.get_objects(
                self.interpreter, score_threshold=min_score, image_scale=scale)

        return self.create_detection_result(objs, src_size, detection_session.tracker)

    def create_detection_session(self):
        return TrackerDetectionSession()


def create_scrypted_plugin():
    return CoralPlugin()
