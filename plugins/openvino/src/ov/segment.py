from __future__ import annotations

import asyncio
import os
import traceback

import numpy as np

from ov import async_infer
import openvino as ov
from predict.segment import Segmentation
from predict import Prediction
from predict.rectangle import Rectangle
from common import yolo
import time
from common import yolov9_seg

prepareExecutor, predictExecutor = async_infer.create_executors("Segment")


def xywh2xyxy(x):
    """Convert [x_center, y_center, width, height] to [x1, y1, x2, y2]"""
    y = np.copy(x)
    y[:, 0] = x[:, 0] - x[:, 2] / 2  # x1
    y[:, 1] = x[:, 1] - x[:, 3] / 2  # y1
    y[:, 2] = x[:, 0] + x[:, 2] / 2  # x2
    y[:, 3] = x[:, 1] + x[:, 3] / 2  # y2
    return y


def box_iou(box1, box2):
    """Calculate IoU between two sets of boxes"""
    # box1 shape: (n, 4), box2 shape: (m, 4)
    # Compute intersection areas
    area1 = (box1[:, 2] - box1[:, 0]) * (box1[:, 3] - box1[:, 1])
    area2 = (box2[:, 2] - box2[:, 0]) * (box2[:, 3] - box2[:, 1])

    iou = np.zeros((len(box1), len(box2)), dtype=np.float32)

    for i in range(len(box1)):
        for j in range(len(box2)):
            # Intersection
            inter_x1 = np.maximum(box1[i, 0], box2[j, 0])
            inter_y1 = np.maximum(box1[i, 1], box2[j, 1])
            inter_x2 = np.minimum(box1[i, 2], box2[j, 2])
            inter_y2 = np.minimum(box1[i, 3], box2[j, 3])

            inter_w = np.maximum(0, inter_x2 - inter_x1)
            inter_h = np.maximum(0, inter_y2 - inter_y1)
            inter_area = inter_w * inter_h

            # Union
            union = area1[i] + area2[j] - inter_area
            iou[i, j] = inter_area / union if union > 0 else 0

    return iou


def nms(boxes, scores, iou_thres):
    """Non-Maximum Suppression implementation in NumPy"""
    if len(boxes) == 0:
        return np.array([], dtype=np.int32)

    # Sort by scores in descending order
    indices = np.argsort(-scores)

    keep = []
    while len(indices) > 0:
        i = indices[0]
        keep.append(i)

        if len(indices) == 1:
            break

        # Calculate IoU between the current box and all remaining boxes
        iou_scores = box_iou(boxes[indices[0:1]], boxes[indices[1:]])[0]

        # Keep boxes with IoU below threshold
        indices = indices[1:][iou_scores < iou_thres]

    return np.array(keep, dtype=np.int32)


def non_max_suppression(
        prediction,
        conf_thres=0.25,
        iou_thres=0.45,
        classes=None,
        agnostic=False,
        multi_label=False,
        labels=(),
        max_det=300,
        nm=0,  # number of masks
):
    """Non-Maximum Suppression (NMS) on inference results to reject overlapping detections

    Returns:
         list of detections, on (n,6) tensor per image [xyxy, conf, cls]
    """

    if isinstance(prediction, (list, tuple)):  # YOLO model in validation model, output = (inference_out, loss_out)
        prediction = prediction[0]  # select only inference output

    bs = prediction.shape[0]  # batch size
    nc = prediction.shape[1] - nm - 4  # number of classes
    mi = 4 + nc  # mask start index
    xc = np.max(prediction[:, 4:mi], axis=1) > conf_thres  # candidates

    # Checks
    assert 0 <= conf_thres <= 1, f'Invalid Confidence threshold {conf_thres}, valid values are between 0.0 and 1.0'
    assert 0 <= iou_thres <= 1, f'Invalid IoU {iou_thres}, valid values are between 0.0 and 1.0'

    # Settings
    # min_wh = 2  # (pixels) minimum box width and height
    max_wh = 7680  # (pixels) maximum box width and height
    max_nms = 30000  # maximum number of boxes into NMS()
    time_limit = 2.5 + 0.05 * bs  # seconds to quit after
    redundant = True  # require redundant detections
    multi_label &= nc > 1  # multiple labels per box (adds 0.5ms/img)
    merge = False  # use merge-NMS

    t = time.time()
    output = [np.zeros((0, 6 + nm), dtype=np.float32)] * bs
    for xi, pred_x in enumerate(prediction):  # image index, image inference
        # Apply constraints
        # x[((x[:, 2:4] < min_wh) | (x[:, 2:4] > max_wh)).any(1), 4] = 0  # width-height
        x = pred_x.T[xc[xi]]  # confidence

        # Cat apriori labels if autolabelling
        if labels and len(labels[xi]):
            lb = labels[xi]
            v = np.zeros((len(lb), nc + nm + 5), dtype=x.dtype)
            v[:, :4] = lb[:, 1:5]  # box
            v[np.arange(len(lb)), lb[:, 0].astype(int) + 4] = 1.0  # cls
            x = np.concatenate((x, v), 0)

        # If none remain process next image
        if x.shape[0] == 0:
            continue

        # Detections matrix nx6 (xyxy, conf, cls)
        box = x[:, :4]
        cls = x[:, 4:4 + nc]
        mask = x[:, 4 + nc:] if nm > 0 else np.zeros((x.shape[0], nm), dtype=x.dtype)

        box = xywh2xyxy(box)  # center_x, center_y, width, height) to (x1, y1, x2, y2)

        if multi_label:
            i, j = np.where(cls > conf_thres)
            x = np.concatenate((box[i], x[i, 4 + j][:, None], j[:, None].astype(np.float32), mask[i]), 1)
        else:  # best class only
            j = np.argmax(cls, axis=1, keepdims=True)
            conf = cls[np.arange(len(cls)), j.flatten()][:, None]
            x = np.concatenate((box, conf, j.astype(np.float32), mask), 1)[conf.flatten() > conf_thres]

        # Filter by class
        if classes is not None:
            class_tensor = np.array(classes, dtype=np.float32)
            mask = np.any(x[:, 5:6] == class_tensor, axis=1)
            x = x[mask]

        # Apply finite constraint
        # if not np.isfinite(x).all():
        #     x = x[np.isfinite(x).all(1)]

        # Check shape
        n = x.shape[0]  # number of boxes
        if n == 0:  # no boxes
            continue
        elif n > max_nms:  # excess boxes
            x = x[x[:, 4].argsort()[::-1][:max_nms]]  # sort by confidence
        else:
            x = x[x[:, 4].argsort()[::-1]]  # sort by confidence

        # Batched NMS
        c = x[:, 5:6] * (0 if agnostic else max_wh)  # classes
        boxes, scores = x[:, :4] + c, x[:, 4]  # boxes (offset by class), scores
        i = nms(boxes, scores, iou_thres)  # NMS
        if i.shape[0] > max_det:  # limit detections
            i = i[:max_det]
        if merge and (1 < n < 3E3):  # Merge NMS (boxes merged using weighted mean)
            # update boxes as boxes(i,4) = weights(i,n) * boxes(n,4)
            iou = box_iou(boxes[i], boxes) > iou_thres  # iou matrix
            weights = iou * scores[None]  # box weights
            x[i, :4] = np.dot(weights, x[:, :4]).astype(np.float32) / weights.sum(1, keepdims=True)  # merged boxes
            if redundant:
                i = i[iou.sum(1) > 1]  # require redundancy

        output[xi] = x[i]
        if (time.time() - t) > time_limit:
            import warnings
            warnings.warn(f'WARNING ⚠️ NMS time limit {time_limit:.3f}s exceeded')
            break  # time limit exceeded

    return output



class OpenVINOSegmentation(Segmentation):
    def __init__(self, plugin, nativeId: str):
        super().__init__(plugin=plugin, nativeId=nativeId)

    def loadModel(self, name):
        name = name + "_int8"
        model_path = self.downloadHuggingFaceModelLocalFallback(name)
        ovmodel = "best-converted"
        xmlFile = os.path.join(model_path, f"{ovmodel}.xml")
        model = self.plugin.core.compile_model(xmlFile, self.plugin.mode)
        return model

    async def detect_once(self, input, settings, src_size, cvss):
        def predict():
            im = np.expand_dims(input, axis=0)
            im = im.transpose((0, 3, 1, 2))  # BHWC to BCHW, (n, 3, h, w)
            im = im.astype(np.float32) / 255.0
            im = np.ascontiguousarray(im)  # contiguous

            infer_request = self.model.create_infer_request()
            tensor = ov.Tensor(array=im)
            infer_request.set_input_tensor(tensor)
            output_tensors = infer_request.infer()

            pred = output_tensors[0]
            proto = output_tensors[1]
            pred = non_max_suppression(pred, nm=32)

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
                            ymax=float(det[i, 3]),  # y2
                        ),
                        embedding=None,  # no embedding for segmentation
                        clipPaths=clip_paths  # list of polygon outlines [[[x, y], ...], ...] at 320x320
                    )
                    objs.append(prediction)

            return objs

        try:
            objs = await asyncio.get_event_loop().run_in_executor(
                predictExecutor, lambda: predict()
            )
        except:
            traceback.print_exc()
            raise

        ret = self.create_detection_result(objs, src_size, cvss)
        return ret
