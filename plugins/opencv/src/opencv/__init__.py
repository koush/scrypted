from __future__ import annotations

import asyncio
import concurrent.futures
from typing import Any, List, Tuple
import time

import cv2
import imutils
import numpy as np
import scrypted_sdk
from PIL import Image
from scrypted_sdk.types import (ObjectDetectionGeneratorSession,ObjectDetectionSession,
                                ObjectDetectionResult, ObjectsDetected,
                                Setting, VideoFrame)

from detect import DetectPlugin

# vips is already multithreaded, but needs to be kicked off the python asyncio thread.
toThreadExecutor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="image")

async def to_thread(f):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(toThreadExecutor, f)

async def ensureGrayData(data: bytes, size: Tuple[int, int], format: str):
    if format == 'gray':
        return data

    def convert():
        if format == 'rgba':
            image = Image.frombuffer('RGBA', size, data)
        else:
            image = Image.frombuffer('RGB', size, data)

        try:
            return image.convert('L').tobytes()
        finally:
            image.close()
    return await to_thread(convert)


class OpenCVDetectionSession:
    def __init__(self) -> None:
        self.cap: cv2.VideoCapture = None
        self.previous_frame: Any = None
        self.curFrame = None
        self.frameDelta = None
        self.dilated = None
        self.thresh = None
        self.gray = None
        self.gstsample = None
        self.lastFrame = 0


defaultThreshold = 50
defaultArea = 200
defaultBlur = 5

class OpenCVPlugin(DetectPlugin):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId=nativeId)

    def getClasses(self) -> list[str]:
        return ['motion']

    def getModelSettings(self, settings: Any = None) -> list[Setting]:
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
                'title': "Blur Radius",
                'description': "The radius of the blur applied to denoise small amounts of motion.",
                'value': defaultBlur,
                'key': 'blur',
                'placeholder': defaultBlur,
                'type': 'number',
            },
        ]

        return settings
    
    def get_input_format(self) -> str:
        return 'gray'

    def parse_settings(self, settings: Any):
        area = defaultArea
        threshold = defaultThreshold
        blur = defaultBlur
        referenceFrameFrequency = 0
        if settings:
            area = float(settings.get('area', area))
            threshold = int(settings.get('threshold', threshold))
            blur = int(settings.get('blur', blur))
            referenceFrameFrequency = float(settings.get('referenceFrameFrequency', 0))
        return area, threshold, blur, referenceFrameFrequency

    def detect(self, frame, detection_session: ObjectDetectionSession, src_size, convert_to_src_size) -> ObjectsDetected:
        session: OpenCVDetectionSession = detection_session['settings']['session']
        settings = detection_session and detection_session.get('settings', None)
        area, threshold, blur, referenceFrameFrequency = self.parse_settings(settings)

        gray = frame
        session.curFrame = cv2.GaussianBlur(
            gray, (blur, blur), 0, dst=session.curFrame)

        detections: List[ObjectDetectionResult] = []
        detection_result: ObjectsDetected = {}
        now = round(time.time() * 1000)
        detection_result['timestamp'] = now
        detection_result['detections'] = detections
        detection_result['inputDimensions'] = src_size

        if session.previous_frame is None or session.previous_frame.shape != session.curFrame.shape:
            session.previous_frame = session.curFrame
            session.curFrame = None
            return detection_result

        session.frameDelta = cv2.absdiff(
            session.previous_frame, session.curFrame, dst=session.frameDelta)
        if not referenceFrameFrequency or now - session.lastFrame > referenceFrameFrequency:
            tmp = session.curFrame
            session.curFrame = session.previous_frame
            session.previous_frame = tmp

        _, session.thresh = cv2.threshold(
            session.frameDelta, threshold, 255, cv2.THRESH_BINARY, dst=session.thresh)
        session.dilated = cv2.dilate(
            session.thresh, None, iterations=2, dst=session.dilated)
        fcontours = cv2.findContours(
            session.dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = imutils.grab_contours(fcontours)


        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            # if w * h != contour_area:
            #     print("mismatch w/h", contour_area - w * h)

            x2, y2 = convert_to_src_size((x + w, y + h))
            x, y = convert_to_src_size((x, y))
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
    
    def get_input_details(self) -> Tuple[int, int, int]:
        return (300, 300, 1)

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

    async def generateObjectDetections(self, videoFrames: Any, detection_session: ObjectDetectionGeneratorSession = None) -> Any:
        if not detection_session:
            detection_session = {}
        if not detection_session.get('settings'):
            detection_session['settings'] = {}
        settings = detection_session['settings']
        settings['session'] = OpenCVDetectionSession()
        return super().generateObjectDetections(videoFrames, detection_session)

    async def run_detection_image(self, videoFrame: scrypted_sdk.Image, detection_session: ObjectDetectionSession) -> ObjectsDetected:
        width = videoFrame.width
        height = videoFrame.height

        aspectRatio = width / height
        
        # dont bother resizing if its already fairly small
        if width <= 640 and height < 640:
            scale = 1
            resize = None
        else:
            if aspectRatio > 1:
                scale = height / 300
                height = 300
                width = int(300 * aspectRatio)
            else:
                width = 300
                height = int(300 / aspectRatio)
                scale = width / 300
            resize = {
                'width': width,
                'height': height,
            }

        format = videoFrame.format or 'gray'
        buffer = await videoFrame.toBuffer({
            'resize': resize,
            'format': format,
        })

        if format == 'gray':
            expectedLength = width * height
            # check if resize could not be completed
            if expectedLength != len(buffer):
                image = Image.frombuffer('L', (videoFrame.width, videoFrame.height), buffer)
                try:
                    buffer = image.resize((width, height), Image.BILINEAR).tobytes()
                finally:
                    image.close()
        else:
            buffer = await ensureGrayData(buffer, (width, height), format)

        def convert_to_src_size(point):
            return point[0] * scale, point[1] * scale
        mat = np.ndarray((height, width, 1), buffer=buffer, dtype=np.uint8)
        detections = self.detect(mat, detection_session, (videoFrame.width, videoFrame.height), convert_to_src_size)
        return detections
