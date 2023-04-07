from __future__ import annotations

import asyncio
import concurrent.futures
import os
import re
import urllib.request
from typing import Any, List, Tuple

import scrypted_sdk
from PIL import Image
from scrypted_sdk.types import (ObjectDetectionResult, ObjectDetectionSession,
                                ObjectsDetected, Setting)

from detect import DetectPlugin

from .rectangle import (Rectangle, combine_rect, from_bounding_box,
                        intersect_area, intersect_rect, to_bounding_box)

# vips is already multithreaded, but needs to be kicked off the python asyncio thread.
toThreadExecutor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="image")

async def to_thread(f):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(toThreadExecutor, f)

async def ensureRGBData(data: bytes, size: Tuple[int, int], format: str):
    if format != 'rgba':
        return Image.frombuffer('RGB', size, data)

    def convert():
        rgba = Image.frombuffer('RGBA', size, data)
        try:
            return rgba.convert('RGB')
        finally:
            rgba.close()
    return await to_thread(convert)

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

        # periodic restart because there seems to be leaks in tflite or coral API.
        loop = asyncio.get_event_loop()
        loop.call_later(4 * 60 * 60, lambda: self.requestRestart())

    def downloadFile(self, url: str, filename: str):
        filesPath = os.path.join(os.environ['SCRYPTED_PLUGIN_VOLUME'], 'files')
        fullpath = os.path.join(filesPath, filename)
        if os.path.isfile(fullpath):
            return fullpath
        os.makedirs(filesPath, exist_ok=True)
        tmp = fullpath + '.tmp'
        urllib.request.urlretrieve(url, tmp)
        os.rename(tmp, fullpath)
        return fullpath

    def getClasses(self) -> list[str]:
        return list(self.labels.values())

    def getTriggerClasses(self) -> list[str]:
        return ['motion']

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

        return [allowList]

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
                x, y = convert_to_src_size((bb[0], bb[1]))
                x2, y2 = convert_to_src_size(
                    (bb[0] + bb[2], bb[1] + bb[3]))
                detection['boundingBox'] = (x, y, x2 - x + 1, y2 - y + 1)
                detection_result['detections'].append(detection)

        # print(detection_result)
        return detection_result

    def get_detection_input_size(self, src_size):
        # signals to pipeline that any input size is fine
        # previous code used to resize to correct size and run detection that way.
        # new code will resize the frame and potentially do multiple passes.
        # this is useful for high quality thumbnails.
        return (None, None)

    def get_input_size(self) -> Tuple[int, int]:
        pass

    async def detect_once(self, input: Image.Image, settings: Any, src_size, cvss) -> ObjectsDetected:
        pass

    async def run_detection_videoframe(self, videoFrame: scrypted_sdk.VideoFrame, detection_session: ObjectDetectionSession) -> ObjectsDetected:
        settings = detection_session and detection_session.get('settings')
        src_size = videoFrame.width, videoFrame.height
        w, h = self.get_input_size()
        input_aspect_ratio = w / h
        iw, ih = src_size
        src_aspect_ratio = iw / ih
        ws = w / iw
        hs = h / ih
        s = max(ws, hs)

        # image is already correct aspect ratio, so it can be processed in a single pass.
        if input_aspect_ratio == src_aspect_ratio:
            def cvss(point):
                return point[0], point[1]

            # aspect ratio matches, but image must be scaled.
            resize = None
            if ih != w:
                resize = {
                    'width': w,
                    'height': h,
                }

            data = await videoFrame.toBuffer({
                'resize': resize,
                'format': videoFrame.format or 'rgb',
            })
            image = await ensureRGBData(data, (w, h), videoFrame.format)
            try:
                ret = await self.detect_once(image, settings, src_size, cvss)
                return ret
            finally:
                image.close()

        sw = int(w / s)
        sh = int(h / s)
        first_crop = (0, 0, sw, sh)


        ow = iw - sw
        oh = ih - sh
        second_crop = (ow, oh, ow + sw, oh + sh)

        firstData, secondData = await asyncio.gather(
            videoFrame.toBuffer({
                'resize': {
                    'width': w,
                    'height': h,
                },
                'crop': {
                    'left': 0,
                    'top': 0,
                    'width': sw,
                    'height': sh,
                },
                'format': videoFrame.format or 'rgb',
            }),
            videoFrame.toBuffer({
                'resize': {
                    'width': w,
                    'height': h,
                },
                'crop': {
                    'left': ow,
                    'top': oh,
                    'width': sw,
                    'height': sh,
                },
                'format': videoFrame.format or 'rgb',
            })
        )

        first, second = await asyncio.gather(
            ensureRGBData(firstData, (w, h), videoFrame.format),
            ensureRGBData(secondData, (w, h), videoFrame.format)
        )

        def cvss1(point):
            return point[0] / s, point[1] / s
        def cvss2(point):
            return point[0] / s + ow, point[1] / s + oh

        ret1 = await self.detect_once(first, settings, src_size, cvss1)
        first.close()
        ret2 = await self.detect_once(second, settings, src_size, cvss2)
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
        return ret
