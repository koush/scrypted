from __future__ import annotations

from typing import Tuple


from ov import async_infer
from predict import PredictPlugin
import asyncio
from common import coco

customDetectPrepare, customDetectPredict = async_infer.create_executors("CustomDetect")

class Segmentation(PredictPlugin):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

        self.inputwidth = 320
        self.inputheight = 320
        self.loop = asyncio.get_event_loop()
        self.labels = coco.COCO_LABELS

        try:
            self.model = self.loadModel('yolov9c_seg')
        except:
            raise

    def loadModel(self, name: str):
        pass


    # width, height, channels
    def get_input_details(self) -> Tuple[int, int, int]:
        return (self.inputwidth, self.inputheight, 3)

    def get_input_size(self) -> Tuple[float, float]:
        return (self.inputwidth, self.inputheight)

    def get_input_format(self) -> str:
        return "rgb"