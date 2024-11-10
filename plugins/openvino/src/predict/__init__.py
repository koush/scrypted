from __future__ import annotations

import asyncio
import os
import math
import traceback
import urllib.request
from typing import Any, List, Tuple

import scrypted_sdk
from PIL import Image
from scrypted_sdk.types import (ObjectDetectionResult, ObjectDetectionSession,
                                ObjectsDetected, Setting)

import common.colors
from detect import DetectPlugin
from predict.rectangle import Rectangle

class Prediction:
    def __init__(self, id: int, score: float, bbox: Rectangle, embedding: str = None):
        # these may be numpy values. sanitize them.
        self.id = int(id)
        self.score = float(score)
        # ensure all floats from numpy
        self.bbox = Rectangle(
            float(bbox.xmin),
            float(bbox.ymin),
            float(bbox.xmax),
            float(bbox.ymax),
        )
        self.embedding = embedding

class PredictPlugin(DetectPlugin):
    labels: dict

    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

        # periodic restart of main plugin because there seems to be leaks in tflite or coral API.
        if not nativeId:
            loop = asyncio.get_event_loop()
            loop.call_later(4 * 60 * 60, lambda: self.requestRestart())
        
        self.batch: List[Tuple[Any, asyncio.Future]] = []
        self.batching = 0
        self.batch_flush = None

    def downloadFile(self, url: str, filename: str):
        try:
            filesPath = os.path.join(os.environ['SCRYPTED_PLUGIN_VOLUME'], 'files')
            fullpath = os.path.join(filesPath, filename)
            if os.path.isfile(fullpath):
                return fullpath
            tmp = fullpath + '.tmp'
            print("Creating directory for", tmp)
            os.makedirs(os.path.dirname(fullpath), exist_ok=True)
            print("Downloading", url)
            response = urllib.request.urlopen(url)
            if response.getcode() < 200 or response.getcode() >= 300:
                raise Exception(f"Error downloading")
            read = 0
            with open(tmp, "wb") as f:
                while True:
                    data = response.read(1024 * 1024)
                    if not data:
                        break
                    read += len(data)
                    print("Downloaded", read, "bytes")
                    f.write(data)
            os.rename(tmp, fullpath)
            return fullpath
        except:
            print("Error downloading", url)
            import traceback
            traceback.print_exc()
            raise

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
            # check bounding box for nan
            if any(map(lambda x: not math.isfinite(x), detection['boundingBox'])):
                print("unexpected nan detected", obj.bbox)
                continue
            detection['className'] = className
            detection['score'] = obj.score
            if hasattr(obj, 'embedding') and obj.embedding is not None:
                detection['embedding'] = obj.embedding
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
                if any(map(lambda x: not math.isfinite(x), detection['boundingBox'])):
                    print("unexpected nan detected", obj.bbox)
                    continue
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

    async def detect_batch(self, inputs: List[Any]) -> List[Any]:
        pass

    async def run_batch(self):
        batch = self.batch
        self.batch = []
        self.batching = 0

        if len(batch):
            inputs = [x[0] for x in batch]
            try:
                results = await self.detect_batch(inputs)
                for i, result in enumerate(results):
                    batch[i][1].set_result(result)
            except Exception as e:
                for input in batch:
                    input[1].set_exception(e)

    async def flush_batch(self):
        self.batch_flush = None
        await self.run_batch()

    async def queue_batch(self, input: Any) -> List[Any]:
        future = asyncio.Future(loop = asyncio.get_event_loop())
        self.batch.append((input, future))
        if self.batching:
            self.batching = self.batching - 1
            if self.batching:
                # if there is any sort of error or backlog, .
                if not self.batch_flush:
                    self.batch_flush = self.loop.call_later(.5, lambda: asyncio.ensure_future(self.flush_batch()))
                return await future
        await self.run_batch()
        return await future

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
        batch = (detection_session and detection_session.get('batch')) or 0
        self.batching += batch

        iw, ih = image.width, image.height
        w, h = self.get_input_size()

        if w is None or h is None:
            resize = None
            w = image.width
            h = image.height
            def cvss(point):
                return point
        else:
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

        format = image.format or self.get_input_format()

        # if the model requires yuvj444p, convert the image to yuvj444p directly
        # if possible, otherwise use whatever is available and convert in the detection plugin
        if self.get_input_format() == 'yuvj444p':
            if image.ffmpegFormats != True:
                format = image.format or 'rgb'

        b = await image.toBuffer({
            'resize': resize,
            'format': format,
        })

        if self.get_input_format() == 'rgb':
            data = await common.colors.ensureRGBData(b, (w, h), format)
        elif self.get_input_format() == 'rgba':
            data = await common.colors.ensureRGBAData(b, (w, h), format)
        elif self.get_input_format() == 'yuvj444p':
            data = await common.colors.ensureYCbCrAData(b, (w, h), format)
        else:
            raise Exception("unsupported format")

        try:
            ret = await self.safe_detect_once(data, settings, (iw, ih), cvss)
            return ret
        finally:
            data.close()
