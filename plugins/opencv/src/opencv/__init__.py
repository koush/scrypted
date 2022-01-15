from __future__ import annotations
from time import sleep
from detect import DetectionSession, DetectPlugin
from typing import Any, List
import numpy as np
import cv2
import imutils
from gi.repository import Gst
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected

class OpenCVDetectionSession(DetectionSession):
    def __init__(self) -> None:
        super().__init__()
        self.cap: cv2.VideoCapture = None
        self.previous_frame: Any = None
        self.curFrame = None
        self.frameDelta = None
        self.dilated = None
        self.thresh = None
        self.gray = None
        self.gstsample = None

defaultThreshold = 25
defaultArea = 2000
defaultInterval = 250

class OpenCVPlugin(DetectPlugin):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)
        self.color2Gray = None
        self.pixelFormat = "I420"
        self.pixelFormatChannelCount = 1

        if True:
            self.retainAspectRatio = False
            self.color2Gray = None
            self.pixelFormat = "I420"
            self.pixelFormatChannelCount = 1
        else:
            self.retainAspectRatio = True
            self.color2Gray = cv2.COLOR_BGRA2GRAY
            self.pixelFormat = "BGRA"
            self.pixelFormatChannelCount = 4

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
        return self.pixelFormat

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

        # see get_detection_input_size on undocumented size requirements for GRAY8
        if self.color2Gray != None:
            detection_session.gray = cv2.cvtColor(frame, self.color2Gray, dst=detection_session.gray)
            gray = detection_session.gray
        else:
            gray = frame
        detection_session.curFrame = cv2.GaussianBlur(gray, (21,21), 0, dst=detection_session.curFrame)

        if detection_session.previous_frame is None:
            detection_session.previous_frame = detection_session.curFrame
            detection_session.curFrame = None
            return

        detection_session.frameDelta = cv2.absdiff(detection_session.previous_frame, detection_session.curFrame, dst=detection_session.frameDelta)
        tmp = detection_session.curFrame
        detection_session.curFrame = detection_session.previous_frame
        detection_session.previous_frame = tmp

        _, detection_session.thresh = cv2.threshold(detection_session.frameDelta, threshold, 255, cv2.THRESH_BINARY, dst=detection_session.thresh)
        detection_session.dilated = cv2.dilate(detection_session.thresh, None, iterations=2, dst=detection_session.dilated)
        fcontours = cv2.findContours(detection_session.dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = imutils.grab_contours(fcontours)

        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = src_size
        
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            # if w * h != contour_area:
            #     print("mismatch w/h", contour_area - w * h)

            x2, y2, _ = convert_to_src_size((x + w, y + h))
            x, y, _ = convert_to_src_size((x, y))
            w = x2 - x + 1
            h = y2 - y + 1

            contour_area = w * h

            if not area or contour_area > area:
                detection: ObjectDetectionResult = {}
                detection['boundingBox'] = (x, y, w, h)
                detection['className'] = 'motion'
                detection['score'] = 1 if area else contour_area
                detections.append(detection)

        return detection_result                

    def run_detection_jpeg(self, detection_session: DetectionSession, image_bytes: bytes, min_score: float) -> ObjectsDetected:
        raise Exception('can not run motion detection on image')

    def get_detection_input_size(self, src_size):
        # The initial implementation of this plugin used BGRA
        # because it seemed impossible to pull the Y frame out of I420 without corruption.
        # This is because while 318x174 is aspect ratio correct,
        # it seems to cause strange issues with stride and the image is skewed.
        # By using 300x300, this seems to avoid some undocumented minimum size
        # reqiurement in gst-videoscale or opencv. Unclear which.

        # This is the same input size as tensorflow-lite. Allows for better pipelining.
        if not self.retainAspectRatio:
            return (300, 300)

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
                self.pixelFormatChannelCount),
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
