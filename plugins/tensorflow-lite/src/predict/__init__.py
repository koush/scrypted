from __future__ import annotations
from scrypted_sdk.types import ObjectDetectionResult, ObjectsDetected, Setting
import io
from PIL import Image
import re
import scrypted_sdk
from typing import Any, List, Tuple
import asyncio
import time
from .rectangle import Rectangle, intersect_area, intersect_rect, to_bounding_box, from_bounding_box, combine_rect

from detect import DetectionSession, DetectPlugin

from .sort_oh import tracker
import numpy as np

try:
    from gi.repository import Gst
except:
    pass

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

def is_same_box(bb1, bb2, threshold = .7):
    r1 = from_bounding_box(bb1)
    r2 = from_bounding_box(bb2)
    ia = intersect_area(r1, r2)

    if not ia:
        return False, None

    a1 = bb1[2] * bb1[3]
    a2 = bb2[2] * bb2[3]

    # if area intersect area is too small, these are different boxes
    if ia / a1 < threshold or ia / a2 < threshold:
        return False, None

    l = min(bb1[0], bb2[0])
    t = min(bb1[1], bb2[1])
    r = max(bb1[0] + bb1[2], bb2[0] + bb2[2])
    b = max(bb1[1] + bb1[3], bb2[1] + bb2[3])

    w = r - l
    h = b - t

    return True, (l, t, w, h)

def is_same_detection(d1: ObjectDetectionResult, d2: ObjectDetectionResult):
    if d1['className'] != d2['className']:
        return False, None

    return is_same_box(d1['boundingBox'], d2['boundingBox'])

def dedupe_detections(input: List[ObjectDetectionResult], is_same_detection = is_same_detection):
    input = input.copy()
    detections = []
    while len(input):
        d = input.pop()
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
                input.append(d)
                found = True
                break

        if not found:
            detections.append(d)
    return detections

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
        loop.call_later(4 * 60 * 60, lambda: self.requestRestart())

    def getClasses(self) -> list[str]:
        return list(self.labels.values())

    def getTriggerClasses(self) -> list[str]:
        return ['motion']

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

    def getModelSettings(self, settings: Any = None) -> list[Setting]:
        allowList: Setting = {
            'title': 'Detections Types',
            # 'subgroup': 'Advanced',
            'description': 'The detections that will be reported. If none are specified, all detections will be reported. Select only detection types of interest for optimal performance.',
            'choices': self.getClasses(),
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

        trackerWindow: Setting = {
            'title': 'Tracker Window',
            'subgroup': 'Advanced',
            'description': 'Internal Setting. Do not change.',
            'key': 'trackerWindow',
            'value': 3,
            'type': 'number',
        }
        trackerCertainty: Setting = {
            'title': 'Tracker Certainty',
            'subgroup': 'Advanced',
            'description': 'Internal Setting. Do not change.',
            'key': 'trackerCertainty',
            'value': .2,
            'type': 'number',
        }
        return [allowList, trackerWindow, trackerCertainty]

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

    def detect_once(self, input: Image.Image, settings: Any, src_size, cvss) -> ObjectsDetected:
        pass

    def run_detection_image(self, detection_session: PredictSession, image: Image.Image, settings: Any, src_size, convert_to_src_size: Any = None, multipass_crop: Tuple[float, float, float, float] = None):
        (w, h) = self.get_input_size() or image.size
        (iw, ih) = image.size

        if detection_session and not detection_session.tracker:
            t = self.trackers.get(detection_session.id)
            if not t:
                t = tracker.Sort_OH(scene=np.array([iw, ih]))
                t.conf_three_frame_certainty = (settings.get('trackerCertainty') or .2) * 3
                t.conf_unmatched_history_size = settings.get('trackerWindow') or 3
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

            if dx > image.width:
                s = image.width / dx
                dx = image.width
                dy *= s

            if dy > image.height:
                s = image.height / dy
                dy = image.height
                dx *= s

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
            if dx == w and dy == h:
                input = image.crop(crop_box)
            else:
                input = image.resize((w, h), Image.ANTIALIAS, crop_box)

            def cvss(point, normalize=False):
                unscaled = ((point[0] / w) * dx + l, (point[1] / h) * dy + t)
                converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
                return converted

            ret = self.detect_once(input, settings, src_size, cvss)
            input.close()
            detection_session.processed = detection_session.processed + 1
            return ret, RawImage(image)
        
        ws = w / iw
        hs = h / ih
        s = max(ws, hs)
        if ws == 1 and hs == 1:
            def cvss(point, normalize=False):
                converted = convert_to_src_size(point, normalize) if convert_to_src_size else (point[0], point[1], True)
                return converted

            ret = self.detect_once(image, settings, src_size, cvss)
            if detection_session:
                detection_session.processed = detection_session.processed + 1
        else:
            sw = int(w / s)
            sh = int(h / s)
            first_crop = (0, 0, sw, sh)
            first = image.resize((w, h), Image.ANTIALIAS, first_crop)
            ow = iw - sw
            oh = ih - sh
            second_crop = (ow, oh, ow + sw, oh + sh)
            second = image.resize((w, h), Image.ANTIALIAS, second_crop)

            def cvss1(point, normalize=False):
                unscaled = (point[0] / s, point[1] / s)
                converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
                return converted
            def cvss2(point, normalize=False):
                unscaled = (point[0] / s + ow, point[1] / s + oh)
                converted = convert_to_src_size(unscaled, normalize) if convert_to_src_size else (unscaled[0], unscaled[1], True)
                return converted

            ret1 = self.detect_once(first, settings, src_size, cvss1)
            first.close()
            if detection_session:
                detection_session.processed = detection_session.processed + 1
            ret2 = self.detect_once(second, settings, src_size, cvss2)
            if detection_session:
                detection_session.processed = detection_session.processed + 1
            second.close()

            two_intersect = intersect_rect(Rectangle(*first_crop), Rectangle(*second_crop))

            def is_same_detection_middle(d1: ObjectDetectionResult, d2: ObjectDetectionResult):
                same, ret = is_same_detection(d1, d2)
                if same:
                    return same, ret

                if d1['className'] != d2['className']:
                    return False, None

                r1 = from_bounding_box(d1['boundingBox'])
                m1 = intersect_rect(two_intersect, r1)
                if not m1:
                    return False, None

                r2 = from_bounding_box(d2['boundingBox'])
                m2 = intersect_rect(two_intersect, r2)
                if not m2:
                    return False, None

                same, ret = is_same_box(to_bounding_box(m1), to_bounding_box(m2))
                if not same:
                    return False, None
                c = to_bounding_box(combine_rect(r1, r2))
                return True, c

            ret = ret1
            ret['detections'] = dedupe_detections(ret1['detections'] + ret2['detections'], is_same_detection=is_same_detection_middle)

        if detection_session:
            self.track(detection_session, ret)

        if not len(ret['detections']):
            return ret, RawImage(image)

        return ret, RawImage(image)
    
    def track(self, detection_session: PredictSession, ret: ObjectsDetected):
        detections = ret['detections']
        sort_input = []
        for d in ret['detections']:
            r: ObjectDetectionResult = d
            l, t, w, h = r['boundingBox']
            sort_input.append([l, t, l + w, t + h, r['score']])
        trackers, unmatched_trckr, unmatched_gts = detection_session.tracker.update(np.array(sort_input), [])
        for td in trackers:
            x0, y0, x1, y1, trackID = td[0].item(), td[1].item(
            ), td[2].item(), td[3].item(), td[4].item()
            slop = 0
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
                # intersect area always gonna be smaller than
                # the detection or tracker area.
                # greater numbers, ie approaching 2, is better.
                dslop = area / ta + area / da
                if (dslop > slop):
                    slop = dslop
                    obj = ob
            if obj:
                obj['id'] = str(trackID)
            # this may happen if tracker predicts something is still in the scene
            # but was not detected
            # else:
            #     print('unresolved tracker')
        # for d in detections:
        #     if not d.get('id'):
        #         # this happens if the tracker is not confident in a new detection yet due
        #         # to low score or has not been found in enough frames
        #         if d['className'] == 'person':
        #             print('untracked %s: %s' % (d['className'], d['score']))


    def run_detection_crop(self, detection_session: DetectionSession, sample: RawImage, settings: Any, src_size, convert_to_src_size, bounding_box: Tuple[float, float, float, float]) -> ObjectsDetected:
        (ret, _) = self.run_detection_image(detection_session, sample.image, settings, src_size, convert_to_src_size, bounding_box)
        return ret

    def run_detection_gstsample(self, detection_session: PredictSession, gstsample, settings: Any, src_size, convert_to_src_size) -> Tuple[ObjectsDetected, Image.Image]:
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
