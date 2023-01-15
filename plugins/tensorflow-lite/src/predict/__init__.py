from __future__ import annotations
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected, Setting
import io
from PIL import Image
import re
import scrypted_sdk
from typing import Any, List, Tuple, Mapping
from gi.repository import Gst
import asyncio
import time
import sys

from detect import DetectionSession, DetectPlugin
from collections import namedtuple

from .sort_oh import tracker
import numpy as np

Rectangle = namedtuple('Rectangle', 'xmin ymin xmax ymax')

def intersect_area(a: Rectangle, b: Rectangle):  # returns None if rectangles don't intersect
    dx = min(a.xmax, b.xmax) - max(a.xmin, b.xmin)
    dy = min(a.ymax, b.ymax) - max(a.ymin, b.ymin)
    if (dx>=0) and (dy>=0):
        return dx*dy

class PredictSession(DetectionSession):
    image: Image.Image
    tracker: sort_oh.tracker.Sort_OH

    def __init__(self, start_time: float) -> None:
        super().__init__()
        self.image = None
        self.processed = 0
        self.start_time = start_time
        self.tracker = None

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


class RawImage:
    jpegMediaObject: scrypted_sdk.MediaObject

    def __init__(self, image: Image.Image):
        self.image = image
        self.jpegMediaObject = None

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

class Prediction:
    def __init__(self, id: int, score: float, bbox: Tuple[float, float, float, float]):
        self.id = id
        self.score = score
        self.bbox = bbox

class PredictPlugin(DetectPlugin, scrypted_sdk.BufferConverter, scrypted_sdk.Settings):
    labels: dict

    def __init__(self, PLUGIN_MIME_TYPE: str, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        self.fromMimeType = PLUGIN_MIME_TYPE
        self.toMimeType = scrypted_sdk.ScryptedMimeTypes.MediaObject.value

        self.crop = False
        self.trackers: Mapping[str, tracker.Sort_OH] = {}

        # periodic restart because there seems to be leaks in tflite or coral API.
        loop = asyncio.get_event_loop()
        # loop.call_later(60 * 60, lambda: self.requestRestart())

    async def createMedia(self, data: RawImage) -> scrypted_sdk.MediaObject:
        mo = await scrypted_sdk.mediaManager.createMediaObject(data, self.fromMimeType)
        return mo

    def end_session(self, detection_session: PredictSession):
        image = detection_session.image
        if image:
            detection_session.image = None
            image.close()

        dps = detection_session.processed / (time.time() - detection_session.start_time)
        print("Detections per second %s" % dps)
        return super().end_session(detection_session)

    def invalidateMedia(self, detection_session: PredictSession, data: RawImage):
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
                raise Exception('data is no longer valid')

            bio = io.BytesIO()
            image.save(bio, format='JPEG')
            jpegBytes = bio.getvalue()
            mo = await scrypted_sdk.mediaManager.createMediaObject(jpegBytes, 'image/jpeg')
            data.jpegMediaObject = mo
        return mo

    def requestRestart(self):
        asyncio.ensure_future(scrypted_sdk.deviceManager.requestRestart())

    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        pass

    async def getDetectionModel(self, settings: Any = None) -> ObjectDetectionModel:
        height, width, channels = self.get_input_details()

        d: ObjectDetectionModel = {
            'name': self.pluginId,
            'classes': list(self.labels.values()),
            'inputSize': [int(width), int(height), int(channels)],
        }

        decoderSetting: Setting = {
            'title': "Decoder",
            'description': "The gstreamer element used to decode the stream",
            'combobox': True,
            'value': 'Default',
            'placeholder': 'Default',
            'key': 'decoder',
            'choices': [
                'Default',
                'decodebin',
                'parsebin ! vtdec_hw',
                'parsebin ! h264parse ! nvh264dec',
                'rtph264depay ! h264parse ! nvh264dec',
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

        d['settings'] = [
            decoderSetting,
            allowList
        ]
        return d

    def create_detection_result(self, objs: List[Prediction], size, allowList, convert_to_src_size=None) -> ObjectsDetected:
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

    def run_detection_jpeg(self, detection_session: PredictSession, image_bytes: bytes, settings: Any) -> ObjectsDetected:
        stream = io.BytesIO(image_bytes)
        image = Image.open(stream)

        detections, _ = self.run_detection_image(detection_session, image, settings, image.size)
        return detections

    def get_detection_input_size(self, src_size):
        # signals to pipeline that any input size is fine
        # previous code used to resize to correct size and run detection that way.
        # new code will resize the frame and potentially do multiple passes.
        # this is useful for high quality thumbnails.
        return (None, None)

    def get_input_size(self) -> Tuple[float, float]:
        pass

    def detect_once(self, input: Image.Image, settings: Any, src_size, cvss):
        pass

    def run_detection_image(self, detection_session: PredictSession, image: Image.Image, settings: Any, src_size, convert_to_src_size: Any = None, multipass_crop: Tuple[float, float, float, float] = None):
        (w, h) = self.get_input_size()
        (iw, ih) = image.size

        if not detection_session.tracker:
            t = self.trackers.get(detection_session.id)
            if not t:
                t = tracker.Sort_OH(scene=np.array([iw, ih]))
                self.trackers[detection_session.id] = t
            detection_session.tracker = t
            # conf_trgt = 0.35
            # conf_objt = 0.75
            # detection_session.tracker.conf_trgt = conf_trgt
            # detection_session.tracker.conf_objt = conf_objt

        # this a single pass or the second pass. detect once and return results.
        if multipass_crop:
            (l, t, dx, dy) = multipass_crop

            # find center
            cx = l + dx / 2
            cy = t + dy / 2

            # fix aspect ratio on box
            if dx / w > dy / h:
                dy = dx / w * h
            else:
                dx = dy / h * w

            # crop size to fit input size
            if dx < w:
                dx = w
            if dy < h:
                dy = h
            
            l = cx - dx / 2
            t = cy - dy / 2
            if l < 0:
                l = 0
            if t < 0:
                t = 0
            if l + dx > iw:
                l = iw - dx
            if t + dy > ih:
                t = ih - dy
            crop_box = (l, t, l + dx, t + dy)
            input = image.crop(crop_box)
            (cw, ch) = input.size
            if cw != w or h != ch:
                input = input.resize((w, h), Image.ANTIALIAS)

            def cvss(point, normalize=False):
                unscaled = ((point[0] / w) * cw + l, (point[1] / h) * ch + t)
                converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
                return converted

            ret = self.detect_once(input, settings, src_size, cvss)
            detection_session.processed = detection_session.processed + 1
            return ret, RawImage(image)
        
        ws = w / iw
        hs = h / ih
        s = max(ws, hs)
        if ws == 1 and hs == 1:
            scaled = image
        else:
            scaled = image.resize((int(round(s * iw)), int(round(s * ih))), Image.ANTIALIAS)

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
     
        ret1 = self.detect_once(first, settings, src_size, cvss1)
        detection_session.processed = detection_session.processed + 1
        ret2 = self.detect_once(second, settings, src_size, cvss2)
        detection_session.processed = detection_session.processed + 1

        ret = ret1
        ret['detections'] = ret1['detections'] + ret2['detections']

        if not len(ret['detections']):
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

        ret['detections'] = detections

        if not multipass_crop:
            print('trackering')
            sort_input = []
            for d in ret['detections']:
                r: ObjectDetectionResult = d
                l, t, w, h = r['boundingBox']
                sort_input.append([l, t, l + w, t + h, r['score']])
            trackers, unmatched_trckr, unmatched_gts = detection_session.tracker.update(np.array(sort_input), [])
            print('trackers %s', trackers)

            detections = ret['detections']
            ret['detections'] = []

            for td in trackers:
                x0, y0, x1, y1, trackID = td[0].item(), td[1].item(
                ), td[2].item(), td[3].item(), td[4].item()
                slop = sys.maxsize
                obj: ObjectDetectionResult = None
                ta = (x1 - x0) * (y1 - y0)
                box = Rectangle(x0, y0, x1, y1)
                for d in detections:
                    if d.get('id'):
                        continue
                    ob: ObjectDetectionResult = d
                    dx0, dy0, dw, dh = ob['boundingBox']
                    dx1 = dx0 + dw
                    dy1 = dy0 + dh
                    da = dw * dh
                    area = intersect_area(Rectangle(dx0, dy0, dx1, dy1), box)
                    if not area:
                        continue
                    dslop = ta + da - area * 2
                    if (dslop < slop):
                        slop = dslop
                        obj = ob

                if obj:
                    obj['id'] = str(trackID)
                    ret['detections'].append(obj)

        return ret, RawImage(image)

    def run_detection_crop(self, detection_session: DetectionSession, sample: RawImage, settings: Any, src_size, convert_to_src_size, bounding_box: Tuple[float, float, float, float]) -> ObjectsDetected:
        (ret, _) = self.run_detection_image(detection_session, sample.image, settings, src_size, convert_to_src_size, bounding_box)
        return ret

    def run_detection_gstsample(self, detection_session: PredictSession, gstsample, settings: Any, src_size, convert_to_src_size) -> Tuple[ObjectsDetected, Image.Image]:
        if False:
            # pycoral supports fast path with gst sample directly which can be used if detection snapshots
            # are not needed.
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
                    image.frombytes(bytes(info.data))
                else:
                    image = Image.frombuffer('RGB', (width, height), bytes(info.data))
            finally:
                gst_buffer.unmap(info)

        return self.run_detection_image(detection_session, image, settings, src_size, convert_to_src_size)

    def create_detection_session(self):
        return PredictSession(start_time=time.time())
