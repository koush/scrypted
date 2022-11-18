from __future__ import annotations
from typing_extensions import TypedDict
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected, Setting
import threading
import io
from .common import *
from PIL import Image, ImageOps
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
from collections import namedtuple

Rectangle = namedtuple('Rectangle', 'xmin ymin xmax ymax')

def intersect_area(a: Rectangle, b: Rectangle):  # returns None if rectangles don't intersect
    dx = min(a.xmax, b.xmax) - max(a.xmin, b.xmin)
    dy = min(a.ymax, b.ymax) - max(a.ymin, b.ymin)
    if (dx>=0) and (dy>=0):
        return dx*dy

class QueuedSample(TypedDict):
    gst_buffer: Any
    eventId: str

class TensorFlowLiteSession(DetectionSession):
    image: Image.Image
    previousDetections: List[ObjectDetectionResult]

    def __init__(self) -> None:
        super().__init__()
        self.image = None
        self.previousDetections = None

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


defaultThreshold = .2
defaultSecondThreshold = .7

class RawImage:
    jpegMediaObject: scrypted_sdk.MediaObject

    def __init__(self, image: Image.Image):
        self.image = image
        self.jpegMediaObject = None

MIME_TYPE = 'x-scrypted-tensorflow-lite/x-raw-image'

def is_same_detection(d1: ObjectDetectionResult, d2: ObjectDetectionResult):
    if d1['className'] != d2['className']:
        return False, None
    
    bb1 = d1['boundingBox']
    bb2 = d2['boundingBox']

    r1 = Rectangle(bb1[0], bb1[1], bb1[0] + bb1[2], bb1[1] + bb1[3])
    r2 = Rectangle(bb2[0], bb2[1], bb2[0] + bb2[2], bb2[1] + bb2[3])
    ia = intersect_area(r1, r2)

    if not ia:
        return False, None

    a1 = bb1[2] * bb1[3]
    a2 = bb2[2] * bb2[3]

    # if area intersect area is too small, these are different boxes
    if ia / a1 < .4 and ia / a2 < .4:
        return False, None

    l = min(bb1[0], bb2[0])
    t = min(bb1[1], bb2[1])
    r = max(bb1[0] + bb1[2], bb2[0] + bb2[2])
    b = max(bb1[1] + bb1[3], bb2[1] + bb2[3])

    w = r - l
    h = b - t

    return True, (l, t, w, h)


class TensorFlowLitePlugin(DetectPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        self.fromMimeType = MIME_TYPE
        self.toMimeType = scrypted_sdk.ScryptedMimeTypes.MediaObject.value

        self.crop = False

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

    async def getSettings(self) -> list[Setting]:
        coral: Setting = {
            'title': 'Detected Edge TPU',
            'description': 'The device paths of the Coral Edge TPUs that will be used for detections.',
            'value': self.edge_tpu_found,
            'readonly': True,
            'key': 'coral',
        }

        return [coral]
    
    async def putSetting(self, key: str, value: scrypted_sdk.SettingValue) -> None:
        pass

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
        data.jpegMediaObject = None

    async def convert(self, data: RawImage, fromMimeType: str, toMimeType: str, options: scrypted_sdk.BufferConvertorOptions = None) -> Any:
        mo = data.jpegMediaObject
        if not mo:
            image = data.image
            if not image:
                raise Exception('tensorflow-lite data is no longer valid')

            bio = io.BytesIO()
            image.save(bio, format='JPEG')
            jpegBytes = bio.getvalue()
            mo = await scrypted_sdk.mediaManager.createMediaObject(jpegBytes, 'image/jpeg')
            data.jpegMediaObject = mo
        return mo

    def requestRestart(self):
        asyncio.ensure_future(scrypted_sdk.deviceManager.requestRestart())

    async def getDetectionModel(self, settings: Any = None) -> ObjectDetectionModel:
        with self.mutex:
            _, height, width, channels = self.interpreter.get_input_details()[
                0]['shape']

        d: ObjectDetectionModel = {
            'name': '@scrypted/tensorflow-lite',
            'classes': list(self.labels.values()),
            'inputSize': [int(width), int(height), int(channels)],
        }

        if settings:
            second_score_threshold = None
            check = settings.get(
                'second_score_threshold', None)
            if check:
                second_score_threshold = float(check)
            if second_score_threshold:
                d['inputStream'] = 'local'

        confidence: Setting = {
            'title': 'Minimum Detection Confidence',
            'description': 'Higher values eliminate false positives and low quality recognition candidates.',
            'key': 'score_threshold',
            'type': 'number',
            'value': defaultThreshold,
            'placeholder': defaultThreshold,
        }
        secondConfidence: Setting = {
            'title': 'Second Pass Confidence',
            'description': 'Scale, crop, and reanalyze the results from the initial detection pass to get more accurate results. This will exponentially increase complexity, so using an allow list is recommended',
            'key': 'second_score_threshold',
            'type': 'number',
            'value': defaultSecondThreshold,
            'placeholder': defaultSecondThreshold,
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
            'value': [
                'person',
                'dog',
                'cat',
                'car',
                'truck',
                'bus',
                'motorcycle',
            ],
        }

        d['settings'] = [confidence, secondConfidence, decoderSetting, allowList]
        return d

    def create_detection_result(self, objs, size, allowList, convert_to_src_size=None) -> ObjectsDetected:
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

    def run_detection_jpeg(self, detection_session: TensorFlowLiteSession, image_bytes: bytes, settings: Any) -> ObjectsDetected:
        stream = io.BytesIO(image_bytes)
        image = Image.open(stream)

        detections, _ = self.run_detection_image(detection_session, image, settings, image.size)
        return detections

    def get_detection_input_size(self, src_size):
        return (None, None)
        with self.mutex:
            return input_size(self.interpreter)

    def detect_once(self, input: Image.Image, score_threshold: float, settings: Any, src_size, cvss):
        with self.mutex:
            common.set_input(
                self.interpreter, input)
            scale = (1, 1)
            # _, scale = common.set_resized_input(
            #     self.interpreter, cropped.size, lambda size: cropped.resize(size, Image.ANTIALIAS))
            self.interpreter.invoke()
            objs = detect.get_objects(
                self.interpreter, score_threshold=score_threshold, image_scale=scale)

        allowList = settings.get('allowList', None) if settings else None
        ret = self.create_detection_result(objs, src_size, allowList, cvss)
        return ret

    def run_detection_image(self, detection_session: TensorFlowLiteSession, image: Image.Image, settings: Any, src_size, convert_to_src_size: Any = None, second_pass_crop: Tuple[float, float, float, float] = None):
        score_threshold = defaultThreshold
        second_score_threshold = None
        if settings:
            score_threshold = float(settings.get(
                'score_threshold', score_threshold) or score_threshold)
            check = settings.get(
                'second_score_threshold', None)
            if check:
                second_score_threshold = float(check)

        if second_pass_crop:
            score_threshold = second_score_threshold

        (w, h) = input_size(self.interpreter)

        # this a single pass or the second pass. detect once and return results.
        if second_pass_crop or not second_score_threshold:
            if second_pass_crop:
                (l, t, r, b) = second_pass_crop
                cropped = image.crop(second_pass_crop)
                (cw, ch) = cropped.size
                input = cropped.resize((w, h), Image.ANTIALIAS)

                def cvss(point, normalize=False):
                    unscaled = ((point[0] / w) * cw + l, (point[1] / h) * ch + t)
                    converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
                    return converted
            else:
                (iw, ih) = image.size
                ws = w / iw
                hs = h / ih
                s = max(ws, hs)
                scaled = image.resize((round(s * iw), round(s * ih)), Image.ANTIALIAS)
                ow = round((scaled.width - w) / 2)
                oh = round((scaled.height - h) / 2)
                input = scaled.crop((ow, oh, ow + w, oh + h))

                def cvss(point, normalize=False):
                    unscaled = ((point[0] + ow) / s, (point[1] + oh) / s)
                    converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
                    return converted

            ret = self.detect_once(input, score_threshold, settings, src_size, cvss)
            return ret, RawImage(image)
        
        (iw, ih) = image.size

        ws = w / iw
        hs = h / ih
        s = max(ws, hs)
        if ws == 1 and hs == 1:
            scaled = image
        else:
            scaled = image.resize((round(s * iw), round(s * ih)), Image.ANTIALIAS)

        first = scaled.crop((0, 0, w, h))
        (sx, sy) = scaled.size
        ow = sx - w
        oh = sy - h
        second = scaled.crop((ow, oh, ow + w, oh + h))

        def cvss1(point, normalize=False):
            unscaled = (point[0] / s, point[1] / s)
            converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
            return converted
        def cvss2(point, normalize=False):
            unscaled = ((point[0] + ow) / s, (point[1] + oh) / s)
            converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
            return converted
     
        ret1 = self.detect_once(first, score_threshold, settings, src_size, cvss1)
        ret2 = self.detect_once(second, score_threshold, settings, src_size, cvss2)
        r1Detections = list(ret1['detections'])
        r2Detections = list(ret2['detections'])

        ret = ret1
        ret['detections'] = ret1['detections'] + ret2['detections']

        if not len(ret['detections']):
            detection_session.previousDetections = []
            return ret, RawImage(image)
        

        detections: List[ObjectDetectionResult]

        def dedupe_detections():
            nonlocal detections
            detections = []
            while len(ret['detections']):
                d = ret['detections'].pop()
                found = False
                for c in detections:
                    same, box = is_same_detection(d, c)
                    if same:
                        # encompass this box and score
                        d['boundingBox'] = box
                        d['score'] = max(d['score'], c['score'])
                        # remove from current detections list
                        detections = list(filter(lambda r: r != c, detections))
                        # run dedupe again with this new larger item
                        ret['detections'].append(d)
                        found = True
                        break

                if not found:
                    detections.append(d)

        dedupe_detections()

        for detection in detections:
            if detection_session.previousDetections:
                found = False
                for pd in detection_session.previousDetections:
                    if is_same_detection(detection, pd):
                        detection['score'] = max(detection['score'], pd['score'])
                        ret['detections'].append(detection)
                        found = True
                        break
                if found:
                    continue

            if detection['score'] >= second_score_threshold:
                ret['detections'].append(detection)
                continue

            (x, y, dw, dh) = detection['boundingBox']
            cx = x + dw / 2
            cy = y + dh / 2
            d = round(max(dw, dh) * 1.5)
            x = round(cx - d / 2)
            y = round(cy - d / 2)
            x = max(0, x)
            y = max(0, y)
            x2 = x + d
            y2 = y + d

            secondPassResult, _ = self.run_detection_image(detection_session, image, settings, src_size, convert_to_src_size, (x, y, x2, y2))
            filtered = list(filter(lambda d: d['className'] == detection['className'], secondPassResult['detections']))
            filtered.sort(key = lambda c: c['score'], reverse = True)
            ret['detections'].extend(filtered[:1])

        detection_session.previousDetections = ret['detections']
        dedupe_detections()
        ret['detections'] = detections
        return ret, RawImage(image)

    def run_detection_gstsample(self, detection_session: TensorFlowLiteSession, gstsample, settings: Any, src_size, convert_to_src_size) -> Tuple[ObjectsDetected, Image.Image]:
        # todo reenable this if detection images aren't needed.
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

        return self.run_detection_image(detection_session, image, settings, src_size, convert_to_src_size)

    def create_detection_session(self):
        return TensorFlowLiteSession()
