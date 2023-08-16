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
import traceback

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

class Prediction:
    def __init__(self, id: int, score: float, bbox: Tuple[float, float, float, float]):
        self.id = id
        self.score = score
        self.bbox = bbox

class PredictPlugin(DetectPlugin, scrypted_sdk.BufferConverter):
    labels: dict

    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        # periodic restart because there seems to be leaks in tflite or coral API.
        loop = asyncio.get_event_loop()
        loop.call_later(4 * 60 * 60, lambda: self.requestRestart())

    def downloadFile(self, url: str, filename: str):
        filesPath = os.path.join(os.environ['SCRYPTED_PLUGIN_VOLUME'], 'files')
        fullpath = os.path.join(filesPath, filename)
        if os.path.isfile(fullpath):
            return fullpath
        os.makedirs(os.path.dirname(fullpath), exist_ok=True)
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
        return []

    def get_input_format(self) -> str:
        return 'rgb'

    def create_detection_result(self, objs: List[Prediction], size, convert_to_src_size=None) -> ObjectsDetected:
        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = size

        for obj in objs:
            className = self.labels.get(obj.id, obj.id)
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

    async def safe_detect_once(self, input: Image.Image, settings: Any, src_size, cvss) -> ObjectsDetected:
        try:
            f = self.detect_once(input, settings, src_size, cvss)
            return await asyncio.wait_for(f, 60)
        except:
            traceback.print_exc()
            print(
                "encountered an error while detecting. requesting plugin restart."
            )
            self.requestRestart()
            raise

    async def run_detection_image(self, image: scrypted_sdk.Image, detection_session: ObjectDetectionSession) -> ObjectsDetected:
        settings = detection_session and detection_session.get('settings')
        iw, ih = image.width, image.height
        w, h = self.get_input_size()

        resize = None
        xs = w / iw
        ys = h / ih
        def cvss(point):
            return point[0] / xs, point[1] / ys

        if iw != w or ih != h:
            resize = {
                'width': w,
                'height': h,
            }

        b = await image.toBuffer({
            'resize': resize,
            'format': image.format or 'rgb',
        })
        data = await ensureRGBData(b, (w, h), image.format)
        try:
            ret = await self.safe_detect_once(data, settings, (iw, ih), cvss)
            return ret
        finally:
            data.close()
