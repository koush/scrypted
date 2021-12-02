from __future__ import annotations
from asyncio.events import AbstractEventLoop, TimerHandle
from asyncio.futures import Future
from typing import Mapping
from safe_set_result import safe_set_result
import scrypted_sdk
import numpy as np
import re
from pycoral.utils.dataset import read_label_file
from pycoral.utils.edgetpu import make_interpreter
from pycoral.utils.edgetpu import run_inference
from pycoral.adapters.common import input_size
from pycoral.adapters.classify import get_classes
from pycoral.adapters import detect
from PIL import Image
import common
import io
import gstreamer
import json
import asyncio
import time
import os
import binascii
from urllib.parse import urlparse
from gi.repository import Gst
import multiprocessing
import collections

from scrypted_sdk.types import FFMpegInput, Lock, MediaObject, ObjectDetection, ObjectDetectionModel, ObjectDetectionResult, ObjectDetectionSession, OnOff, ObjectsDetected, ScryptedInterface, ScryptedMimeTypes
from scrypted_sdk import print


def avg_fps_counter(window_size):
    window = collections.deque(maxlen=window_size)
    prev = time.monotonic()
    yield 0.0  # First fps value.

    while True:
        curr = time.monotonic()
        window.append(curr - prev)
        prev = curr
        yield len(window) / sum(window)


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


class DetectionSession:
    id: str
    timerHandle: TimerHandle = None
    future: Future
    loop: AbstractEventLoop

    def __init__(self) -> None:
        self.future = Future()

    def cancel(self):
        if self.timerHandle:
            self.timerHandle.cancel()
            self.timerHandle = None

    def timedOut(self):
        safe_set_result(self.future)

    def setTimeout(self, duration: float):
        self.cancel()
        self.loop.call_later(duration, lambda: self.timedOut())


class CoralPlugin(scrypted_sdk.ScryptedDeviceBase, ObjectDetection):
    detection_sessions: Mapping[str, DetectionSession] = {}
    session_mutex = multiprocessing.Lock()

    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)
        labels_contents = scrypted_sdk.zip.open(
            'fs/coco_labels.txt').read().decode('utf8')
        self.labels = parse_label_contents(labels_contents)
        model = scrypted_sdk.zip.open(
            'fs/mobilenet_ssd_v2_coco_quant_postprocess_edgetpu.tflite').read()
        self.interpreter = make_interpreter(model)
        self.interpreter.allocate_tensors()
        self.mutex = multiprocessing.Lock()

    async def getInferenceModels(self) -> list[ObjectDetectionModel]:
        ret = list[ObjectDetectionModel]()
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

    def create_detection_result(self, size, scale):
        objs = detect.get_objects(self.interpreter,image_scale = scale)

        detections = list[ObjectDetectionResult]()
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = size

        for obj in objs:
            detection: ObjectDetectionResult = {}
            detection['boundingBox'] = (
                obj.bbox.xmin, obj.bbox.ymin, obj.bbox.ymax, obj.bbox.ymax)
            detection['className'] = self.labels.get(obj.id, obj.id)
            detection['score'] = obj.score
            detections.append(detection)

        return detection_result

    def detection_event(self, detection_session: DetectionSession, detection_result: ObjectsDetected, event_buffer: bytes = None):
        detection_result['detectionId'] = detection_session.id
        detection_result['timestamp'] = int(time.time() * 1000)
        asyncio.run_coroutine_threadsafe(self.onDeviceEvent(ScryptedInterface.ObjectDetection.value, detection_result), loop=detection_session.loop)

    def end_session(self, detection_session: DetectionSession):
        print('detection ended', detection_session.id)
        detection_session.cancel()
        with self.session_mutex:
            self.detection_sessions.pop(detection_session.id, None)

        detection_result: ObjectsDetected = {}
        detection_result['running'] = False

        self.detection_event(detection_session, detection_result)

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None) -> ObjectsDetected:
        if mediaObject and mediaObject.mimeType.startswith('image/'):
            stream = io.BytesIO(bytes(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg')))
            image = Image.open(stream)

            _, scale = common.set_resized_input(
                self.interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))

            self.interpreter.invoke()

            return self.create_detection_result(image.size, scale)


        duration = None
        detection_id = None
        new_session = False

        if session:
            detection_id = session.get('detectionId', None)
            duration = session.get('duration', None)

        if not detection_id:
            detection_id = binascii.b2a_hex(os.urandom(15)).decode('utf8')

        with self.session_mutex:
            detection_session = self.detection_sessions.get(detection_id, None)
            if not detection_session:
                detection_session = DetectionSession()
                detection_session.id = detection_id
                loop = asyncio.get_event_loop()
                detection_session.loop = loop
                self.detection_sessions[detection_id] = detection_session
                new_session = True

                detection_session.future.add_done_callback(lambda _: self.end_session(detection_session))
            elif not duration:
                self.end_session(detection_session)
                return

        if not duration:
            return

        detection_session.setTimeout(duration / 1000)

        if not new_session:
            return

        b = await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, ScryptedMimeTypes.MediaStreamUrl.value)
        s = b.decode('utf8')
        j: FFMpegInput = json.loads(s)
        container = j['container']
        videofmt = 'raw'
        videosrc = j['url']
        if container == 'mpegts' and videosrc.startswith('tcp://'):
            parsed_url = urlparse(videosrc)
            videofmt = 'gst'
            videosrc = 'tcpclientsrc port=%s host=%s ! tsdemux' % (
                parsed_url.port, parsed_url.hostname)

        size = j['mediaStreamOptions']['video']
        inference_size = input_size(self.interpreter)
        width, height = inference_size
        w, h = (size['width'], size['height'])
        scale = min(width / w, height / h)

        fps_counter = avg_fps_counter(30)


        def user_callback(input_tensor, src_size, inference_box):
            nonlocal fps_counter

            with self.mutex:
                run_inference(self.interpreter, input_tensor)

            # (result, mapinfo) = input_tensor.map(Gst.MapFlags.READ)

            try:
                detection_result = self.create_detection_result(
                    src_size, (scale, scale))
                # self.detection_event(detection_session, detection_result, mapinfo.data.tobytes())
                self.detection_event(detection_session, detection_result)

                if not session or not duration:
                    safe_set_result(detection_session.future)
            finally:
                # input_tensor.unmap(mapinfo)
                pass

        print('detection starting', detection_id)
        pipeline = gstreamer.run_pipeline(detection_session.future, user_callback,
                                          src_size=(
                                              size['width'], size['height']),
                                          appsink_size=inference_size,
                                          videosrc=videosrc,
                                          videofmt=videofmt)
        task = pipeline.run()
        asyncio.ensure_future(task)

        detection_result: ObjectsDetected = {}
        detection_result['detectionId'] = detection_id
        detection_result['running'] = True
        return detection_result


def create_scrypted_plugin():
    return CoralPlugin()
# 