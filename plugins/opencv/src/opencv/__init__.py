from __future__ import annotations
from time import sleep
from detect import DetectionSession, DetectPlugin
from typing import Any, List
import numpy as np
import cv2
import imutils
from gi.repository import GLib, Gst
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected

class OpenCVDetectionSession(DetectionSession):
    cap: cv2.VideoCapture
    previous_frame: Any

    def __init__(self) -> None:
        super().__init__()
        self.previous_frame = None
        self.cap = None

defaultThreshold = 25
defaultArea = 2000
defaultInterval = 250

class OpenCVPlugin(DetectPlugin):
    async def getDetectionModel(self) -> ObjectDetectionModel:
        d: ObjectDetectionModel = {
            'name': '@scrypted/opencv',
            'classes': ['motion'],
        }
        settings = [
            {
                'title': "Motion Area",
                'description': "The area size required to trigger motion. Higher values (larger areas) are less sensitive. Setting this to 0 will output all matches into the console.",
                'value': defaultArea,
                'key': 'area',
                'placeholder': defaultArea,
                'type': 'number',
            },
            {
                'title': "Motion Threshold",
                'description': "The threshold required to consider a pixel changed. Higher values (larger changes) are less sensitive.",
                'value': defaultThreshold,
                'key': 'threshold',
                'placeholder': defaultThreshold,
                'type': 'number',
            },
            {
                'title': "Frame Analysis Interval",
                'description': "The number of milliseconds to wait between motion analysis.",
                'value': defaultInterval,
                'key': 'interval',
                'placeholder': defaultInterval,
                'type': 'number',
            },
        ]
        d['settings'] = settings
        return d

    def get_pixel_format(self):
        return 'BGRA'

    def parse_settings(self, settings: Any):
        area = defaultArea
        threshold = defaultThreshold
        interval = defaultInterval
        if settings:
            area = float(settings.get('area', area))
            threshold = int(settings.get('threshold', threshold))
            interval = float(settings.get('interval', interval))
        return area, threshold, interval

    def detect(self, detection_session: OpenCVDetectionSession, frame, settings: Any, src_size, convert_to_src_size) -> ObjectsDetected:
        area, threshold, interval = self.parse_settings(settings)

        # todo: go from native yuv to gray. tested this with GRAY8 in the gstreamer
        # pipeline but it failed...
        # todo update: tried also decoding straight to I420 and got a seemingly
        # skewed image (packed instead of planar?).
        # that may be the issue. is the hardware decoder lying
        # about the output type? is there a way to coerce it to gray or a sane type?
        gray = cv2.cvtColor(frame, cv2.COLOR_BGRA2GRAY)
        curFrame = cv2.GaussianBlur(gray, (21,21), 0)

        if detection_session.previous_frame is None:
            detection_session.previous_frame = curFrame
            return

        frameDelta = cv2.absdiff(detection_session.previous_frame, curFrame)
        detection_session.previous_frame = curFrame

        _, thresh = cv2.threshold(frameDelta, threshold, 255, cv2.THRESH_BINARY)
        dilated = cv2.dilate(thresh, None, iterations=2)
        fcontours = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = imutils.grab_contours(fcontours)

        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = src_size
        
        for c in contours:
            contour_area = cv2.contourArea(c)
            if not area or contour_area > area:
                x, y, w, h = cv2.boundingRect(c)
                # if w * h != contour_area:
                #     print("mismatch w/h", contour_area - w * h)

                x2, y2 = convert_to_src_size((x + w, y + h))
                x, y = convert_to_src_size((x, y))
                w = x2 - x + 1
                h = y2 - y + 1

                detection: ObjectDetectionResult = {}
                detection['boundingBox'] = (x, y, w, h)
                detection['className'] = 'motion'
                detection['score'] = 1 if area else contour_area
                detections.append(detection)

        return detection_result                

    def run_detection_jpeg(self, detection_session: DetectionSession, image_bytes: bytes, min_score: float) -> ObjectsDetected:
        raise Exception('can not run motion detection on jpeg')

    def get_detection_input_size(self, src_size):
        width, height = src_size
        if (width > height):
            if (width > 318):
                height = height / width * 318
                width = 318
        else:
            if (height > 318):
                width = width / height * 318
                height = 318

        width = int(np.floor(width / 6) * 6)
        height = int(np.floor(height / 6) * 6)

        return width, height

    def end_session(self, detection_session: OpenCVDetectionSession):
        if detection_session and detection_session.cap:
            detection_session.cap.release()
            detection_session.cap = None
        return super().end_session(detection_session)

    def run_detection_gstsample(self, detection_session: OpenCVDetectionSession, gst_sample, settings: Any, src_size, convert_to_src_size)-> ObjectsDetected:
        buf = gst_sample.get_buffer()
        caps = gst_sample.get_caps()
        # can't trust the width value, compute the stride
        height = caps.get_structure(0).get_value('height')
        width = caps.get_structure(0).get_value('width')
        result, info = buf.map(Gst.MapFlags.READ)
        if not result:
            return
        try:
            mat = np.ndarray(
                (height,
                width,
                4),
                buffer=info.data,
                dtype= np.uint8)
            return self.detect(detection_session, mat, settings, src_size, convert_to_src_size)
        finally:
            buf.unmap(info)

    def create_detection_session(self):
        return OpenCVDetectionSession()

    def detection_event_notified(self, settings: Any):
        area, threshold, interval = self.parse_settings(settings)
        # it is safe to block here because gstreamer creates a queue thread
        sleep(interval / 1000)
        return super().detection_event_notified(settings)
