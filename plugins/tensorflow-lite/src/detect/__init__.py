from __future__ import annotations

from asyncio.events import AbstractEventLoop, TimerHandle
from asyncio.futures import Future
from typing import Any, Mapping, List
from pipeline import safe_set_result
import scrypted_sdk
import json
import asyncio
import time
import os
import binascii
from urllib.parse import urlparse
import multiprocessing
from pipeline import run_pipeline

from scrypted_sdk.types import FFMpegInput, MediaObject, ObjectDetection, ObjectDetectionModel, ObjectDetectionSession, ObjectsDetected, ScryptedInterface, ScryptedMimeTypes

def optional_chain(root, *keys):
    result = root
    for k in keys:
        if isinstance(result, dict):
            result = result.get(k, None)
        else:
            result = getattr(result, k, None)
        if result is None:
            break
    return result

class DetectionSession:
    id: str
    timerHandle: TimerHandle
    future: Future
    loop: AbstractEventLoop
    settings: Any
    running: bool
    thread: Any

    def __init__(self) -> None:
        self.timerHandle = None
        self.future = Future()
        self.running = False

    def cancel(self):
        if self.timerHandle:
            self.timerHandle.cancel()
            self.timerHandle = None

    def timedOut(self):
        safe_set_result(self.future)

    def setTimeout(self, duration: float):
        self.cancel()
        self.loop.call_later(duration, lambda: self.timedOut())


class DetectPlugin(scrypted_sdk.ScryptedDeviceBase, ObjectDetection):
    # derp these are class statics, fix this
    detection_sessions: Mapping[str, DetectionSession] = {}
    session_mutex = multiprocessing.Lock()

    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

    async def getInferenceModels(self) -> list[ObjectDetectionModel]:
        ret: List[ObjectDetectionModel] = []

        d = {
            'id': 'opencv',
            'name': 'OpenCV',
            'classes': ['motion'],
            # 'inputShape': [int(width), int(height), int(channels)],
        }
        ret.append(d)
        return ret

    def detection_event(self, detection_session: DetectionSession, detection_result: ObjectsDetected, event_buffer: bytes = None):
        detection_result['detectionId'] = detection_session.id
        detection_result['timestamp'] = int(time.time() * 1000)
        asyncio.run_coroutine_threadsafe(self.onDeviceEvent(
            ScryptedInterface.ObjectDetection.value, detection_result), loop=detection_session.loop)

    def end_session(self, detection_session: DetectionSession):
        print('detection ended', detection_session.id)
        detection_session.cancel()
        safe_set_result(detection_session.future)
        with self.session_mutex:
            self.detection_sessions.pop(detection_session.id, None)

        detection_result: ObjectsDetected = {}
        detection_result['running'] = False
        detection_result['timestamp'] = int(time.time() * 1000)

        self.detection_event(detection_session, detection_result)

    def create_detection_result_status(self, detection_id: str, running: bool):
        detection_result: ObjectsDetected = {}
        detection_result['detectionId'] = detection_id
        detection_result['running'] = running
        detection_result['timestamp'] = int(time.time() * 1000)
        return detection_result

    def run_detection_jpeg(self, detection_session: DetectionSession, image_bytes: bytes, settings: Any) -> ObjectsDetected:
        pass

    def get_detection_input_size(self, src_size):
        pass

    def create_detection_session(self):
        return DetectionSession()

    def run_detection_gstsample(self, detection_session: DetectionSession, gst_sample, settings: Any, src_size, convert_to_src_size) -> ObjectsDetected:
        pass

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None) -> ObjectsDetected:
        settings = None
        duration = None
        detection_id = None
        detection_session = None

        if session:
            detection_id = session.get('detectionId', None)
            duration = session.get('duration', None)
            settings = session.get('settings', None)

        is_image = mediaObject and mediaObject.mimeType.startswith('image/')

        ending = False
        with self.session_mutex:
            if not is_image and not detection_id:
                detection_id = binascii.b2a_hex(os.urandom(15)).decode('utf8')

            if detection_id:
                detection_session = self.detection_sessions.get(
                    detection_id, None)

            if not duration and not is_image:
                ending = True
            elif detection_id and not detection_session:
                if not mediaObject:
                    raise Exception(
                        'session %s inactive and no mediaObject provided' % detection_id)

                detection_session = self.create_detection_session()
                detection_session.id = detection_id
                detection_session.settings = settings
                loop = asyncio.get_event_loop()
                detection_session.loop = loop
                self.detection_sessions[detection_id] = detection_session

                detection_session.future.add_done_callback(
                    lambda _: self.end_session(detection_session))

        if ending:
            if detection_session:
                self.end_session(detection_session)
            return self.create_detection_result_status(detection_id, False)

        if is_image:
            return self.run_detection_jpeg(detection_session, bytes(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg')), settings)

        new_session = not detection_session.running
        if new_session:
            detection_session.running = True

        detection_session.setTimeout(duration / 1000)
        if settings != None:
            detection_session.settings = settings

        if not new_session:
            print("existing session", detection_session.id)
            return self.create_detection_result_status(detection_id, detection_session.running)

        print('detection starting', detection_id)
        b = await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, ScryptedMimeTypes.MediaStreamUrl.value)
        s = b.decode('utf8')
        j: FFMpegInput = json.loads(s)
        container = j.get('container', None)
        videosrc = j['url']
        if container == 'mpegts' and videosrc.startswith('tcp://'):
            parsed_url = urlparse(videosrc)
            videosrc = 'tcpclientsrc port=%s host=%s ! tsdemux' % (
                parsed_url.port, parsed_url.hostname)
        elif videosrc.startswith('rtsp'):
            videosrc = 'rtspsrc location=%s ! rtph264depay ! h264parse' % videosrc

        width = optional_chain(j, 'mediaStreamOptions', 'video', 'width') or 1920
        height = optional_chain(j, 'mediaStreamOptions', 'video', 'height') or 1080
        src_size = (width, height)

        self.run_pipeline(detection_session, duration, src_size, videosrc)

        return self.create_detection_result_status(detection_id, True)

    def get_pixel_format(self):
        return 'RGB'

    def run_pipeline(self, detection_session: DetectionSession, duration, src_size, video_input):
        inference_size = self.get_detection_input_size(src_size)

        first_frame = True
        def user_callback(gst_sample, src_size, convert_to_src_size):
            try:
                nonlocal first_frame
                if first_frame:
                    first_frame = False
                    print("first frame received", detection_session.id)

                detection_result = self.run_detection_gstsample(
                    detection_session, gst_sample, detection_session.settings, src_size, convert_to_src_size)
                if detection_result:
                    self.detection_event(detection_session, detection_result)

                if not detection_session or not duration:
                    safe_set_result(detection_session.future)
            finally:
                pass

        pipeline = run_pipeline(detection_session.future, user_callback,
                                          appsink_size=inference_size,
                                          video_input=video_input,
                                          pixel_format=self.get_pixel_format())
        task = pipeline.run()
        asyncio.ensure_future(task)
