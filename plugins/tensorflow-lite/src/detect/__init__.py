from __future__ import annotations

from asyncio.events import AbstractEventLoop, TimerHandle
from asyncio.futures import Future
from typing import Any, Mapping, Tuple
from typing_extensions import TypedDict

from numpy import number
from pipeline import GstPipeline, GstPipelineBase, create_pipeline_sink, safe_set_result
import scrypted_sdk
import json
import asyncio
import time
import os
import binascii
from urllib.parse import urlparse
import threading
from pipeline import run_pipeline
import platform

from gi.repository import Gst

from scrypted_sdk.types import FFmpegInput, MediaObject, ObjectDetection, ObjectDetectionCallbacks, ObjectDetectionSession, ObjectsDetected, ScryptedInterface, ScryptedMimeTypes


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


class PipelineValve:
    allowPacketCounter: int

    def __init__(self, gst, name) -> None:
        self.allowPacketCounter = 1
        self.mutex = threading.Lock()
        valve = gst.get_by_name(name + "Valve")
        self.pad = valve.get_static_pad("src")
        self.name = name

        needRemove = False

        def probe(pad, info):
            nonlocal needRemove
            if needRemove:
                self.close()
                return Gst.PadProbeReturn.DROP
            # REMOVE - remove this probe, passing the data.
            needRemove = True
            return Gst.PadProbeReturn.PASS

        # need one buffer to go through to go into flowing state
        self.probe = self.pad.add_probe(
            Gst.PadProbeType.BLOCK | Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST, probe)

    def open(self):
        with self.mutex:
            if self.probe != None:
                self.pad.remove_probe(self.probe)
                self.probe = None

    def close(self):
        with self.mutex:
            if self.probe != None:
                self.pad.remove_probe(self.probe)
                self.probe = None

            def probe(pad, info):
                return Gst.PadProbeReturn.OK

            self.probe = self.pad.add_probe(
                Gst.PadProbeType.BLOCK | Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST, probe)


def setupPipelineValve(name: str, gst: Any) -> PipelineValve:
    ret = PipelineValve(gst, name)
    return ret


class DetectionSession:
    id: str
    timerHandle: TimerHandle
    future: Future
    loop: AbstractEventLoop
    settings: Any
    running: bool
    plugin: DetectPlugin
    callbacks: ObjectDetectionCallbacks

    def __init__(self) -> None:
        self.timerHandle = None
        self.future = Future()
        self.running = False
        self.attached = False
        self.mutex = threading.Lock()
        self.valve: PipelineValve = None
        self.last_sample = time.time()

    def clearTimeoutLocked(self):
        if self.timerHandle:
            self.timerHandle.cancel()
            self.timerHandle = None

    def clearTimeout(self):
        with self.mutex:
            self.clearTimeoutLocked()

    def timedOut(self):
        self.plugin.end_session(self)

    def setTimeout(self, duration: float):
        with self.mutex:
            self.clearTimeoutLocked()
            self.timerHandle = self.loop.call_later(
                duration, lambda: self.timedOut())


class DetectionSink(TypedDict):
    pipeline: str
    input_size: Tuple[number, number]


class DetectPlugin(scrypted_sdk.ScryptedDeviceBase, ObjectDetection):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)
        self.detection_sessions: Mapping[str, DetectionSession] = {}
        self.session_mutex = threading.Lock()
        self.crop = False
        self.loop = asyncio.get_event_loop()

    async def detection_event(self, detection_session: DetectionSession, detection_result: ObjectsDetected, redetect: Any = None, mediaObject = None):
        detection_result['timestamp'] = int(time.time() * 1000)
        if detection_session.callbacks:
            if detection_session.running:
                return await detection_session.callbacks.onDetection(detection_result, redetect, mediaObject)
            else:
                await detection_session.callbacks.onDetectionEnded(detection_result)
        else:
            # legacy path, nuke this pattern in opencv, pam diff, and full tensorflow.
            detection_result['detectionId'] = detection_session.id
            await self.onDeviceEvent(ScryptedInterface.ObjectDetection.value, detection_result)

    def end_session(self, detection_session: DetectionSession):
        print('detection ended', detection_session.id)

        detection_session.clearTimeout()
        if detection_session.attached:
            with detection_session.mutex:
                if detection_session.running:
                    print("choked session", detection_session.id)
                    detection_session.running = False
                    if detection_session.valve:
                        detection_session.valve.close()
        else:
            # leave detection_session.running as True to avoid race conditions.
            # the removal from detection_sessions will restart it.
            safe_set_result(detection_session.loop, detection_session.future)
            with self.session_mutex:
                self.detection_sessions.pop(detection_session.id, None)

        detection_result: ObjectsDetected = {}
        detection_result['running'] = False

        asyncio.run_coroutine_threadsafe(self.detection_event(detection_session, detection_result), loop=detection_session.loop)

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

    def run_detection_gstsample(self, detection_session: DetectionSession, gst_sample, settings: Any, src_size, convert_to_src_size) -> Tuple[ObjectsDetected, Any]:
        pass

    def run_detection_crop(self, detection_session: DetectionSession, sample: Any, settings: Any, src_size, convert_to_src_size, bounding_box: Tuple[float, float, float, float]) -> ObjectsDetected:
        print("not implemented")
        pass

    def ensure_session(self, mediaObjectMimeType: str, session: ObjectDetectionSession) -> Tuple[bool, DetectionSession, ObjectsDetected]:
        settings = None
        duration = None
        detection_id = None
        detection_session = None

        if session:
            detection_id = session.get('detectionId', None)
            duration = session.get('duration', None)
            settings = session.get('settings', None)

        is_image = mediaObjectMimeType and mediaObjectMimeType.startswith(
            'image/')

        ending = False
        new_session = False
        with self.session_mutex:
            if not is_image and not detection_id:
                detection_id = binascii.b2a_hex(os.urandom(15)).decode('utf8')

            if detection_id:
                detection_session = self.detection_sessions.get(
                    detection_id, None)

            if duration == None and not is_image:
                ending = True
            elif detection_id and not detection_session:
                if not mediaObjectMimeType:
                    return (False, None, self.create_detection_result_status(detection_id, False))

                new_session = True
                detection_session = self.create_detection_session()
                detection_session.plugin = self
                detection_session.id = detection_id
                detection_session.settings = settings
                loop = asyncio.get_event_loop()
                detection_session.loop = loop
                self.detection_sessions[detection_id] = detection_session

                detection_session.future.add_done_callback(
                    lambda _: self.end_session(detection_session))

        if not ending and detection_session and time.time() - detection_session.last_sample > 30 and not mediaObjectMimeType:
            print('detection session has not received a sample in 30 seconds, terminating',
                  detection_session.id)
            ending = True

        if ending:
            if detection_session:
                self.end_session(detection_session)
            return (False, None, self.create_detection_result_status(detection_id, False))

        if is_image:
            return (False, detection_session, None)

        detection_session.setTimeout(duration / 1000)
        if settings != None:
            detection_session.settings = settings

        if not new_session:
            print("existing session", detection_session.id)
            if detection_session.attached:
                with detection_session.mutex:
                    if not detection_session.running:
                        print("unchoked session", detection_session.id)
                        detection_session.running = True
                        if detection_session.valve:
                            detection_session.valve.open()
            return (False, detection_session, self.create_detection_result_status(detection_id, detection_session.running))

        return (True, detection_session, None)

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None, callbacks: ObjectDetectionCallbacks = None) -> ObjectsDetected:
        is_image = mediaObject and mediaObject.mimeType.startswith('image/')

        settings = None
        duration = None

        if session:
            duration = session.get('duration', None)
            settings = session.get('settings', None)

        create, detection_session, objects_detected = self.ensure_session(
            mediaObject and mediaObject.mimeType, session)
        if detection_session:
            detection_session.callbacks = callbacks

        if is_image:
            return self.run_detection_jpeg(detection_session, bytes(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg')), settings)

        if not create:
            # a detection session may have been created, but not started
            # if the initial request was for an image.
            # however, attached sessions should be unchoked, as the pipeline
            # is not managed here.
            if not detection_session or detection_session.attached or detection_session.running or not mediaObject:
                return objects_detected

        detection_id = detection_session.id
        detection_session.running = True

        print('detection starting', detection_id)
        b = await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, ScryptedMimeTypes.MediaStreamUrl.value)
        s = b.decode('utf8')
        j: FFmpegInput = json.loads(s)
        container = j.get('container', None)
        videosrc = j['url']
        if videosrc.startswith('tcp://'):
            parsed_url = urlparse(videosrc)
            videosrc = 'tcpclientsrc port=%s host=%s' % (
                parsed_url.port, parsed_url.hostname)
            if container == 'mpegts':
                videosrc += ' ! tsdemux'
            elif container == 'sdp':
                videosrc += ' ! sdpdemux'
            else:
                raise Exception('unknown container %s' % container)
        elif videosrc.startswith('rtsp'):
            videosrc = 'rtspsrc buffer-mode=0 location=%s protocols=tcp latency=0 is-live=false' % videosrc

        decoder = settings and settings.get('decoder', 'decodebin')
        decoder = decoder or 'Default'
        if decoder == 'Default':
            if platform.system() == 'Darwin':
                decoder = 'vtdec_hw'
            else:
                decoder = 'decodebin'
        videosrc += " ! %s " % decoder

        width = optional_chain(j, 'mediaStreamOptions',
                               'video', 'width') or 1920
        height = optional_chain(j, 'mediaStreamOptions',
                                'video', 'height') or 1080
        src_size = (width, height)

        self.run_pipeline(detection_session, duration, src_size, videosrc)

        return self.create_detection_result_status(detection_id, True)

    def get_pixel_format(self):
        return 'RGB'

    def create_pipeline_sink(self, src_size) -> DetectionSink:
        inference_size = self.get_detection_input_size(src_size)
        ret: DetectionSink = {}

        ret['input_size'] = inference_size
        ret['pipeline'] = create_pipeline_sink(
            type(self).__name__, inference_size, self.get_pixel_format())

        return ret

    def detection_event_notified(self, settings: Any):
        pass

    async def createMedia(self, data: Any) -> MediaObject:
        pass

    def invalidateMedia(self, detection_session: DetectionSession, data: Any):
        pass

    def create_user_callback(self, detection_session: DetectionSession, duration: number):
        first_frame = True

        current_data = None
        current_src_size = None
        current_convert_to_src_size = None

        async def redetect(boundingBox: Tuple[number, number, number, number]):
            nonlocal current_data
            nonlocal current_src_size
            nonlocal current_convert_to_src_size
            if not current_data:
                raise Exception('no sample')

            detection_result = self.run_detection_crop(
                detection_session, current_data, detection_session.settings, current_src_size, current_convert_to_src_size, boundingBox)

            return detection_result['detections']

        async def user_callback(gst_sample, src_size, convert_to_src_size):
            try:
                detection_session.last_sample = time.time()

                nonlocal first_frame
                if first_frame:
                    first_frame = False
                    print("first frame received", detection_session.id)

                detection_result, data = self.run_detection_gstsample(
                    detection_session, gst_sample, detection_session.settings, src_size, convert_to_src_size)
                if detection_result:
                    detection_result['running'] = True

                    mo = None
                    retain = False

                    def maybeInvalidate():
                        if not retain:
                            self.invalidateMedia(detection_session, data)

                    mo = await self.createMedia(data)
                    try:
                        nonlocal current_data
                        nonlocal current_src_size
                        nonlocal current_convert_to_src_size
                        try:
                            current_data = data
                            current_src_size = src_size
                            current_convert_to_src_size = convert_to_src_size
                            retain = await self.detection_event(detection_session, detection_result, redetect, mo)
                        finally:
                            current_data = None
                            current_convert_to_src_size = None
                            current_src_size = None
                            maybeInvalidate()
                    except:
                        self.invalidateMedia(detection_session, data)

                    # asyncio.run_coroutine_threadsafe(, loop = self.loop).result()
                    self.detection_event_notified(detection_session.settings)

                if not detection_session or duration == None:
                    safe_set_result(detection_session.loop,
                                    detection_session.future)
            finally:
                pass

        return user_callback

    def attach_pipeline(self, gstPipeline: GstPipelineBase, session: ObjectDetectionSession, valveName: str = None):
        create, detection_session, objects_detected = self.ensure_session(
            'video/dummy', session)

        if detection_session and valveName:
            valve = setupPipelineValve(valveName, gstPipeline.gst)
            detection_session.valve = valve

        if not create:
            return create, detection_session, objects_detected, None

        detection_session.attached = True

        duration = None
        if session:
            duration = session.get('duration', None)

        pipeline = GstPipeline(gstPipeline.loop, gstPipeline.finished, type(
            self).__name__, self.create_user_callback(detection_session, duration))
        pipeline.attach_launch(gstPipeline.gst)

        return create, detection_session, objects_detected, pipeline

    def detach_pipeline(self, detection_id: str):
        detection_session: DetectionSession = None
        with self.session_mutex:
            detection_session = self.detection_sessions.pop(detection_id)
        if not detection_session:
            raise Exception("pipeline already detached?")
        with detection_session.mutex:
            detection_session.running = False
        detection_session.clearTimeout()

    def run_pipeline(self, detection_session: DetectionSession, duration, src_size, video_input):
        inference_size = self.get_detection_input_size(src_size)

        pipeline = run_pipeline(detection_session.loop, detection_session.future, self.create_user_callback(detection_session, duration),
                                appsink_name=type(self).__name__,
                                appsink_size=inference_size,
                                video_input=video_input,
                                pixel_format=self.get_pixel_format(),
                                crop=self.crop,
                                )
        task = pipeline.run()
        asyncio.ensure_future(task)
