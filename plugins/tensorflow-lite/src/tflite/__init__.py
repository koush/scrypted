from __future__ import annotations
from typing_extensions import TypedDict
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected, Setting
import threading
import io
from .common import *
from PIL import Image
from pycoral.adapters import detect
from pycoral.adapters.common import input_size
loaded_py_coral = False
try:
    from pycoral.utils.edgetpu import run_inference
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
from typing import Any, List, Tuple
from gi.repository import Gst
import asyncio

from detect import DetectionSession, DetectPlugin

class QueuedSample(TypedDict):
    gst_buffer: Any
    eventId: str

class TensorFlowLiteSession(DetectionSession):
    image: Image.Image

    def __init__(self) -> None:
        super().__init__()
        self.image = None

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

class RawImage:
    jpeg: scrypted_sdk.MediaObject

    def __init__(self, image: Image.Image):
        self.image = image
        self.jpeg = None

MIME_TYPE = 'x-scrypted-tensorflow-lite/x-raw-image'

class TensorFlowLitePlugin(DetectPlugin, scrypted_sdk.BufferConverter):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        self.fromMimeType = MIME_TYPE
        self.toMimeType = scrypted_sdk.ScryptedMimeTypes.MediaObject.value

        self.crop = True

        labels_contents = scrypted_sdk.zip.open(
            'fs/coco_labels.txt').read().decode('utf8')
        self.labels = parse_label_contents(labels_contents)
        try:
            edge_tpus = list_edge_tpus()
            print('edge tpus', edge_tpus)
            if not len(edge_tpus):
                raise Exception('no edge tpu found')
            self.edge_tpu_found = str(edge_tpus)
            model = scrypted_sdk.zip.open(
                'fs/mobilenet_ssd_v2_coco_quant_postprocess_edgetpu.tflite').read()
            self.interpreter = make_interpreter(model)
        except Exception as e:
            print('unable to use Coral Edge TPU', e)
            self.edge_tpu_found = 'Edge TPU not found'
            model = scrypted_sdk.zip.open(
                'fs/mobilenet_ssd_v2_coco_quant_postprocess.tflite').read()
            self.interpreter = tflite.Interpreter(model_content=model)
        self.interpreter.allocate_tensors()
        self.mutex = threading.Lock()
        self.sampleQueue = []

        # periodic restart because there seems to be leaks in tflite or coral API.
        loop = asyncio.get_event_loop()
        loop.call_later(4 * 60 * 60, lambda: self.requestRestart())

    async def createMedia(sekf, data: RawImage) -> scrypted_sdk.MediaObject:
        mo = await scrypted_sdk.mediaManager.createMediaObject(data, MIME_TYPE)
        return mo

    def end_session(self, detection_session: TensorFlowLiteSession):
        image = detection_session.image
        if image:
            detection_session.image = None
            image.close()

        return super().end_session(detection_session)

    def invalidateMedia(self, detection_session: TensorFlowLiteSession, data: RawImage):
        if not data:
            return
        image = data.image
        data.image = None
        if image:
            if not detection_session.image:
                detection_session.image = image
            else:
                image.close()
        data.jpeg = None

    async def convert(self, data: RawImage, fromMimeType: str, toMimeType: str, options: scrypted_sdk.BufferConvertorOptions = None) -> Any:
        mo = data.jpeg
        if not mo:
            image = data.image
            if not image:
                raise Exception('tensorflow-lite data is no longer valid')

            bio = io.BytesIO()
            image.save(bio, format='JPEG')
            jpegBytes = bio.getvalue()
            mo = await scrypted_sdk.mediaManager.createMediaObject(jpegBytes, 'image/jpeg')
            data.jpeg = jpegBytes
            data.image = None
        return mo

    def requestRestart(self):
        asyncio.ensure_future(scrypted_sdk.deviceManager.requestRestart())

    async def getDetectionModel(self) -> ObjectDetectionModel:
        with self.mutex:
            _, height, width, channels = self.interpreter.get_input_details()[
                0]['shape']

        d: ObjectDetectionModel = {
            'name': '@scrypted/tensorflow-lite',
            'classes': list(self.labels.values()),
            'inputSize': [int(width), int(height), int(channels)],
        }
        confidence: Setting = {
            'title': 'Minimum Detection Confidence',
            'description': 'Higher values eliminate false positives and low quality recognition candidates.',
            'key': 'score_threshold',
            'type': 'number',
            'value': defaultThreshold,
            'placeholder': defaultThreshold,
        }
        decoderSetting: Setting = {
            'title': "Decoder",
            'description': "The gstreamer element used to decode the stream",
            'combobox': True,
            'value': 'decodebin',
            'placeholder': 'decodebin',
            'key': 'decoder',
            'choices': [
                'decodebin',
                'vtdec_hw',
                'nvh264dec',
            ],
        }
        allowList: Setting = {
            'title': 'Allow List',
            'description': 'The detection classes that will be reported. If none are specified, all detections will be reported.',
            'choices': list(self.labels.values()),
            'multiple': True,
            'key': 'allowList',
            'value': [],
        }
        coral: Setting = {
            'title': 'Detected Edge TPU',
            'description': 'The device paths of the Coral Edge TPUs that will be used for detections.',
            'value': self.edge_tpu_found,
            'readonly': True,
            'key': 'coral',
        }

        d['settings'] = [coral, confidence, decoderSetting, allowList]
        return d

    def create_detection_result(self, objs, size, allowList, convert_to_src_size=None):
        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = size

        for obj in objs:
            className = self.labels.get(obj.id, obj.id)
            if allowList and len(allowList) and className not in allowList:
                continue
            detection: ObjectDetectionResult = {}
            detection['boundingBox'] = (
                obj.bbox.xmin, obj.bbox.ymin, obj.bbox.xmax - obj.bbox.xmin, obj.bbox.ymax - obj.bbox.ymin)
            detection['className'] = className
            detection['score'] = obj.score
            detections.append(detection)

        if convert_to_src_size:
            detections = detection_result['detections']
            detection_result['detections'] = []
            for detection in detections:
                bb = detection['boundingBox']
                x, y, valid = convert_to_src_size((bb[0], bb[1]), True)
                x2, y2, valid2 = convert_to_src_size(
                    (bb[0] + bb[2], bb[1] + bb[3]), True)
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

        score_threshold = self.parse_settings(settings)
        with self.mutex:
            _, scale = common.set_resized_input(
                self.interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))
            self.interpreter.invoke()
            objs = detect.get_objects(
                self.interpreter, score_threshold=score_threshold, image_scale=scale)

        allowList = settings and settings.get('allowList', None)

        return self.create_detection_result(objs, image.size, allowList)

    def get_detection_input_size(self, src_size):
        with self.mutex:
            return input_size(self.interpreter)

    def run_detection_gstsample(self, detection_session: TensorFlowLiteSession, gstsample, settings: Any, src_size, convert_to_src_size) -> Tuple[ObjectsDetected, Image.Image]:
        score_threshold = self.parse_settings(settings)

        if False and loaded_py_coral:
            with self.mutex:
                gst_buffer = gstsample.get_buffer()
                run_inference(self.interpreter, gst_buffer)
                objs = detect.get_objects(
                    self.interpreter, score_threshold=score_threshold)
        else:
            caps = gstsample.get_caps()
            # can't trust the width value, compute the stride
            height = caps.get_structure(0).get_value('height')
            width = caps.get_structure(0).get_value('width')
            gst_buffer = gstsample.get_buffer()
            result, info = gst_buffer.map(Gst.MapFlags.READ)
            if not result:
                return
            try:
                image = detection_session.image
                detection_session.image = None

                if image and (image.width != width or image.height != height):
                    image.close()
                    image = None
                if image:
                    image.frombytes(info.data.tobytes())
                else:
                    image = Image.frombuffer('RGB', (width, height), info.data.tobytes())
            finally:
                gst_buffer.unmap(info)

            with self.mutex:
                _, scale = common.set_resized_input(
                    self.interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))
                self.interpreter.invoke()
                objs = detect.get_objects(
                    self.interpreter, score_threshold=score_threshold, image_scale=scale)

        allowList = settings.get('allowList', None)

        return self.create_detection_result(objs, src_size, allowList, convert_to_src_size), RawImage(image)

    def create_detection_session(self):
        return TensorFlowLiteSession()
