from __future__ import annotations
import threading
from detect import DetectionSession, DetectPlugin
from typing import Any, List
from detect.safe_set_result import safe_set_result
import scrypted_sdk
import numpy as np
import io
import multiprocessing
import cv2
import imutils
from scrypted_sdk.types import ObjectDetectionModel, ObjectDetectionResult, ObjectsDetected

def gst_to_opencv(sample):
    buf = sample.get_buffer()
    caps = sample.get_caps()
    # can't trust the width value, compute the stride
    height = caps.get_structure(0).get_value('height')
    stride = int(buf.get_size() / height / 4)
    width = caps.get_structure(0).get_value('width')
    arr = np.ndarray(
        (height,
         width,
         4),
        buffer=buf.extract_dup(0, buf.get_size()),
        dtype= np.uint8)
    return arr

class OpenCVDetectionSession(DetectionSession):
    cap: cv2.VideoCapture
    previous_frame: Any

    def __init__(self) -> None:
        super().__init__()
        self.previous_frame = None
        self.cap = None
        self.frames_to_skip = 0

defaultThreshold = 25
defaultArea = 0

class OpenCVPlugin(DetectPlugin):
    async def getInferenceModels(self) -> list[ObjectDetectionModel]:
        ret: List[ObjectDetectionModel] = []

        d = {
            'id': 'opencv',
            'name': 'OpenCV',
            'classes': ['motion'],
        }
        ret.append(d)
        return ret

    def get_pixel_format(self):
        return 'BGRA'

    def detect(self, detection_session: OpenCVDetectionSession, frame, min_score: float, src_size, inference_box) -> ObjectsDetected:
        if detection_session.frames_to_skip:
            detection_session.frames_to_skip = detection_session.frames_to_skip - 1
            return
        else:
            detection_session.frames_to_skip = 10

        # todo: go from native yuv to gray. tested this with GRAY8 in the gstreamer
        # pipeline but it failed...
        gray = cv2.cvtColor(frame, cv2.COLOR_BGRA2GRAY)
        curFrame = cv2.GaussianBlur(gray, (21,21), 0)

        if detection_session.previous_frame is None:
            detection_session.previous_frame = curFrame
            return

        frameDelta = cv2.absdiff(detection_session.previous_frame, curFrame)
        detection_session.previous_frame = curFrame

        _, thresh = cv2.threshold(frameDelta, defaultThreshold, 255, cv2.THRESH_BINARY)
        dilated = cv2.dilate(thresh, None, iterations=2)
        fcontours = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = imutils.grab_contours(fcontours)

        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = (frame.shape[1], frame.shape[0])
        
        for c in contours:
            contour_area = cv2.contourArea(c)
            if contour_area > defaultArea:
                x, y, w, h = cv2.boundingRect(c)

                detection: ObjectDetectionResult = {}
                detection['boundingBox'] = (
                    x, y, w, h)
                detection['className'] = 'motion'
                detection['score'] = contour_area
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

    def run_detection_gstsample(self, detection_session: OpenCVDetectionSession, gst_sample, min_score: float, src_size, inference_box, scale)-> ObjectsDetected:
        mat = gst_to_opencv(gst_sample)
        return self.detect(detection_session, mat, min_score, src_size, inference_box)

    def create_detection_session(self):
        return OpenCVDetectionSession()

def create_scrypted_plugin():
    return OpenCVPlugin()
