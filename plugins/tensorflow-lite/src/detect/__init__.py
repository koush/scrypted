from __future__ import annotations

from asyncio.events import AbstractEventLoop, TimerHandle
from asyncio.futures import Future
from typing import Any, Mapping, Tuple
from typing_extensions import TypedDict

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
from .corohelper import run_coro_threadsafe
from PIL import Image
import math
import io

Gst = None
try:
    from gi.repository import Gst
except:
    pass

av = None
try:
    import av
    av.logging.set_level(av.logging.PANIC) 
except:
    pass

from scrypted_sdk.types import ObjectDetectionGeneratorSession, ObjectDetectionModel, Setting, FFmpegInput, MediaObject, ObjectDetection, ObjectDetectionCallbacks, ObjectDetectionSession, ObjectsDetected, ScryptedInterface, ScryptedMimeTypes

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
    plugin: DetectPlugin
    callbacks: ObjectDetectionCallbacks
    user_callback: Any

    def __init__(self) -> None:
        self.timerHandle = None
        self.future = Future()
        self.running = False
        self.mutex = threading.Lock()
        self.last_sample = time.time()
        self.user_callback = None

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
    input_size: Tuple[float, float]


class DetectPlugin(scrypted_sdk.ScryptedDeviceBase, ObjectDetection):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)
        self.detection_sessions: Mapping[str, DetectionSession] = {}
        self.session_mutex = threading.Lock()
        self.crop = False
        self.loop = asyncio.get_event_loop()

    async def getSettings(self) -> list[Setting]:
        activeSessions: Setting = {
            'key': 'activeSessions',
            'readonly': True,
            'title': 'Active Detection Sessions',
            'value': len(self.detection_sessions),
        }
        return [
            activeSessions
        ]
    
    async def putSetting(self, key: str, value: scrypted_sdk.SettingValue) -> None:
        pass

    def getClasses(self) -> list[str]:
        pass

    def getTriggerClasses(self) -> list[str]:
        pass

    def get_input_details(self) -> Tuple[int, int, int]:
        pass

    def getModelSettings(self, settings: Any = None) -> list[Setting]:
        return []

    async def getDetectionModel(self, settings: Any = None) -> ObjectDetectionModel:
        d: ObjectDetectionModel = {
            'name': self.pluginId,
            'classes': self.getClasses(),
            'triggerClasses': self.getTriggerClasses(),
            'inputSize': self.get_input_details(),
            'settings': [],
        }

        decoderSetting: Setting = {
            'title': "Decoder",
            'description': "The tool used to decode the stream. The may be libav or a gstreamer element.",
            'combobox': True,
            'value': 'Default',
            'placeholder': 'Default',
            'key': 'decoder',
            'subgroup': 'Advanced',
            'choices': [
                'Default',
                'libav',
                'decodebin',
                'vtdec_hw',
                'nvh264dec',
                'vaapih264dec',
            ],
        }

        d['settings'] += self.getModelSettings(settings)
        d['settings'].append(decoderSetting)

        return d

    async def detection_event(self, detection_session: DetectionSession, detection_result: ObjectsDetected, redetect: Any = None, mediaObject = None):
        if not detection_session.running and detection_result.get('running'):
            return

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

    async def run_detection_videoframe(self, videoFrame: scrypted_sdk.VideoFrame) -> ObjectsDetected:
        pass

    def run_detection_avframe(self, detection_session: DetectionSession, avframe, settings: Any, src_size, convert_to_src_size) -> Tuple[ObjectsDetected, Any]:
        pil: Image.Image = avframe.to_image()
        return self.run_detection_image(detection_session, pil, settings, src_size, convert_to_src_size)

    def run_detection_image(self, detection_session: DetectionSession, image: Image.Image, settings: Any, src_size, convert_to_src_size) -> Tuple[ObjectsDetected, Any]:
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
            return (False, detection_session, self.create_detection_result_status(detection_id, detection_session.running))

        return (True, detection_session, None)
    
    async def generateObjectDetections(self, videoFrames: Any, session: ObjectDetectionGeneratorSession = None) -> Any:
        try:
            videoFrames = await scrypted_sdk.sdk.connectRPCObject(videoFrames)
            async for videoFrame in videoFrames:
               detected = await self.run_detection_videoframe(videoFrame, session and session.get('settings'))
               yield {
                   '__json_copy_serialize_children': True,
                   'detected': detected,
                   'videoFrame': videoFrame,
               }
        except:
            raise
        finally:
            await videoFrames.aclose()

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None, callbacks: ObjectDetectionCallbacks = None) -> ObjectsDetected:
        is_image = mediaObject and (mediaObject.mimeType.startswith('image/') or mediaObject.mimeType.endswith('/x-raw-image'))

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
            stream = io.BytesIO(bytes(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg')))
            image = Image.open(stream)
            if detection_session:
                if not detection_session.user_callback:
                    detection_session.user_callback = self.create_user_callback(self.run_detection_image, detection_session, duration)
                def convert_to_src_size(point, normalize = False):
                    x, y = point
                    return (int(math.ceil(x)), int(math.ceil(y)), True)

                detection_session.running = True
                try:
                    return await detection_session.user_callback(image, image.size, convert_to_src_size)
                finally:
                    detection_session.running = False
            else:
                return self.run_detection_jpeg(detection_session, bytes(await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg')), settings)

        if not create:
            # a detection session may have been created, but not started
            # if the initial request was for an image.
            # however, attached sessions should be unchoked, as the pipeline
            # is not managed here.
            if not detection_session or detection_session.running or not mediaObject:
                return objects_detected

        detection_id = detection_session.id
        detection_session.running = True

        print('detection starting', detection_id)
        b = await scrypted_sdk.mediaManager.convertMediaObjectToBuffer(mediaObject, ScryptedMimeTypes.FFmpegInput.value)
        s = b.decode('utf8')
        j: FFmpegInput = json.loads(s)

        container = j.get('container', None)
        videosrc = j['url']

        decoder = settings and settings.get('decoder')
        if decoder == 'libav' and not av:
            decoder = None
        elif decoder != 'libav' and not Gst:
            decoder = None

        decoder = decoder or 'Default'
        if decoder == 'Default':
            if Gst:
                if platform.system() == 'Darwin':
                    decoder = 'vtdec_hw'
                else:
                    decoder = 'decodebin'
            elif av:
                decoder = 'libav'

        if decoder == 'libav':
            user_callback = self.create_user_callback(self.run_detection_avframe, detection_session, duration)

            async def inference_loop():
                options = {
                    'analyzeduration': '0',
                    'probesize': '500000',
                    'reorder_queue_size': '0',
                }
                container = av.open(videosrc, options = options)
                stream = container.streams.video[0]

                start = 0
                for idx, frame in enumerate(container.decode(stream)):
                    if detection_session.future.done():
                        container.close()
                        break
                    now = time.time()
                    if not start:
                        start = now
                    elapsed = now - start
                    if (frame.time or 0) < elapsed - 0.500:
                        # print('too slow, skipping frame')
                        continue
                    # print(frame)
                    size = (frame.width, frame.height)
                    def convert_to_src_size(point, normalize = False):
                        x, y = point
                        return (int(math.ceil(x)), int(math.ceil(y)), True)
                    await user_callback(frame, size, convert_to_src_size)

            def thread_main():
                loop = asyncio.new_event_loop()
                loop.run_until_complete(inference_loop())
          
            thread = threading.Thread(target=thread_main)
            thread.start()
            return self.create_detection_result_status(detection_id, True)
        
        if not Gst:
            raise Exception('Gstreamer is unavailable')
      
        videoCodec = optional_chain(j, 'mediaStreamOptions', 'video', 'codec')

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
            if videoCodec == 'h264':
                videosrc += ' ! rtph264depay ! h264parse'

        videosrc += " ! %s" % decoder

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

    def create_user_callback(self, run_detection: Any, detection_session: DetectionSession, duration: float):
        first_frame = True

        current_data = None
        current_src_size = None
        current_convert_to_src_size = None

        async def redetect(boundingBox: Tuple[float, float, float, float]):
            nonlocal current_data
            nonlocal current_src_size
            nonlocal current_convert_to_src_size
            if not current_data:
                raise Exception('no sample')

            detection_result = self.run_detection_crop(
                detection_session, current_data, detection_session.settings, current_src_size, current_convert_to_src_size, boundingBox)

            return detection_result['detections']

        async def user_callback(sample, src_size, convert_to_src_size):
            try:
                detection_session.last_sample = time.time()

                nonlocal first_frame
                if first_frame:
                    first_frame = False
                    print("first frame received", detection_session.id)

                detection_result, data = run_detection(
                    detection_session, sample, detection_session.settings, src_size, convert_to_src_size)
                if detection_result:
                    detection_result['running'] = True

                    mo = None
                    retain = False

                    def maybeInvalidate():
                        if not retain:
                            self.invalidateMedia(detection_session, data)
                        # else:
                        #     print('retaining')

                    mo = await self.createMedia(data)
                    try:
                        nonlocal current_data
                        nonlocal current_src_size
                        nonlocal current_convert_to_src_size
                        try:
                            current_data = data
                            current_src_size = src_size
                            current_convert_to_src_size = convert_to_src_size
                            retain = await run_coro_threadsafe(self.detection_event(detection_session, detection_result, redetect, mo), other_loop=detection_session.loop)
                        finally:
                            current_data = None
                            current_convert_to_src_size = None
                            current_src_size = None
                            maybeInvalidate()
                    except Exception as e:
                        print(e)
                        self.invalidateMedia(detection_session, data)

                    # asyncio.run_coroutine_threadsafe(, loop = self.loop).result()
                    self.detection_event_notified(detection_session.settings)

                if not detection_session or duration == None:
                    safe_set_result(detection_session.loop,
                                    detection_session.future)

                return detection_result
            finally:
                pass

        return user_callback

    def run_pipeline(self, detection_session: DetectionSession, duration, src_size, video_input):
        inference_size = self.get_detection_input_size(src_size)

        pipeline = run_pipeline(detection_session.loop, detection_session.future, self.create_user_callback(self.run_detection_gstsample, detection_session, duration),
                                appsink_name=type(self).__name__,
                                appsink_size=inference_size,
                                video_input=video_input,
                                pixel_format=self.get_pixel_format(),
                                crop=self.crop,
                                )
        task = pipeline.run()
        asyncio.ensure_future(task)
