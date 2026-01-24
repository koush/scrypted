from __future__ import annotations

from typing import Tuple
import numpy as np

from common import async_infer
from common import yolov9_seg
from predict import PredictPlugin
from predict import Prediction
from predict.rectangle import Rectangle
import asyncio
from common import coco
import traceback

customDetectPrepare, customDetectPredict = async_infer.create_executors("Segment")

class Segmentation(PredictPlugin):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

        self.inputwidth = 320
        self.inputheight = 320
        self.loop = asyncio.get_event_loop()
        self.labels = coco.COCO_LABELS

        try:
            self.model = self.loadModel('scrypted_yolov9t_seg_relu')
        except:
            traceback.print_exc()
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

    def process_segmentation_output(self, pred, proto):
        """
        Process segmentation model outputs into a list of Prediction objects.

        Args:
            pred: Predictions output from NMS (list of detections)
            proto: Prototype masks for segmentation

        Returns:
            List of Prediction objects with segmentation masks (clipPaths)
        """
        objs = []
        for det in pred:
            if not len(det):
                continue
            # Upsample masks to input image space (320x320)
            masks = yolov9_seg.process_mask_numpy(proto.squeeze(0), det[:, 6:], det[:, :4], (320, 320), upsample=True)
            # Convert masks to contour points
            segments = yolov9_seg.masks2segments_numpy(masks)
            # Create Prediction instances
            for i in range(len(det)):
                # Convert all contours for this detection to list of [x, y] tuples
                mask_contours = segments[i]
                clip_paths = []
                for contour in mask_contours:
                    if len(contour) > 0 and contour.shape[1] == 2:
                        single_path = [(float(contour[j, 0]), float(contour[j, 1])) for j in range(len(contour))]
                        clip_paths.append(single_path)

                prediction = Prediction(
                    id=int(det[i, 5]),  # class_id
                    score=float(det[i, 4]),  # confidence
                    bbox=Rectangle(
                        xmin=float(det[i, 0]),  # x1
                        ymin=float(det[i, 1]),  # y1
                        xmax=float(det[i, 2]),  # x2
                        ymax=float(det[i, 3]),  # y3
                    ),
                    embedding=None,  # no embedding for segmentation
                    clipPaths=clip_paths  # list of polygon outlines [[[x, y], ...], ...] at 320x320
                )
                objs.append(prediction)

        return objs