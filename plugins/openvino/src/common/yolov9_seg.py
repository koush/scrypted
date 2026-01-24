"""
YOLOv9 Segmentation Parser - Numpy Implementation

This module provides pure numpy implementations of mask processing functions
that are equivalent to their torch counterparts in utils/segment/general.py.
"""

import numpy as np
import cv2
import time

def crop_mask_numpy(masks, boxes):
    """
    Crop predicted masks by zeroing out everything not in the predicted bbox.
    Numpy version of crop_mask.

    Args:
        masks: numpy array [n, h, w] - predicted masks
        boxes: numpy array [n, 4] - bbox coords [x1, y1, x2, y2]

    Returns:
        numpy array [n, h, w] - cropped masks
    """
    n, h, w = masks.shape

    # Safely clamp and normalize bounding boxes
    boxes_clamped = np.clip(boxes, 0, None)
    boxes_clamped[:, 0] = np.minimum(boxes_clamped[:, 0], w)  # x1 <= w
    boxes_clamped[:, 2] = np.minimum(boxes_clamped[:, 2], w)  # x2 <= w
    boxes_clamped[:, 1] = np.minimum(boxes_clamped[:, 1], h)  # y1 <= h
    boxes_clamped[:, 3] = np.minimum(boxes_clamped[:, 3], h)  # y2 <= h

    # Ensure x1 <= x2 and y1 <= y2
    boxes_clamped[:, 0] = np.minimum(boxes_clamped[:, 0], boxes_clamped[:, 2])  # x1 <= x2
    boxes_clamped[:, 1] = np.minimum(boxes_clamped[:, 1], boxes_clamped[:, 3])  # y1 <= y2

    x1 = boxes_clamped[:, 0][:, None, None]  # (n, 1, 1)
    y1 = boxes_clamped[:, 1][:, None, None]  # (n, 1, 1)
    x2 = boxes_clamped[:, 2][:, None, None]  # (n, 1, 1)
    y2 = boxes_clamped[:, 3][:, None, None]  # (n, 1, 1)

    r = np.arange(w).reshape(1, 1, -1)  # (1, 1, w)
    c = np.arange(h).reshape(1, -1, 1)  # (1, h, 1)

    crop_region = (r >= x1) & (r < x2) & (c >= y1) & (c < y2)

    return masks * crop_region


def _upsample_bilinear(masks, target_shape):
    """
    Upsample masks bilinearly to target shape.
    Matches PyTorch's F.interpolate(mode='bilinear', align_corners=False).

    Args:
        masks: numpy array [n, h, w]
        target_shape: tuple (target_h, target_w)

    Returns:
        numpy array [n, target_h, target_w]
    """
    # Defensive check: ensure masks has valid shape
    if len(masks.shape) != 3 or masks.shape[0] == 0:
        print(f"Warning: unexpected mask shape for upsampling: {masks.shape}")
        return masks

    n, h, w = masks.shape
    masks_transposed = masks.transpose(1, 2, 0)  # (h, w, n)

    try:
        upsampled = cv2.resize(
            masks_transposed.astype(np.float32),
            (target_shape[1], target_shape[0]),  # cv2 uses (width, height)
            interpolation=cv2.INTER_LINEAR
        )

        # cv2.resize may return 2D for single-channel input, need to restore 3D shape
        if len(upsampled.shape) == 2:
            # Input was single mask, cv2 returned (H, W) instead of (H, W, 1)
            upsampled = upsampled[:, :, None]  # (H, W, 1)
        result = upsampled.transpose(2, 0, 1)  # (n, h, w)

        # Validate output shape
        if result.shape != (n, target_shape[0], target_shape[1]):
            print(f"Warning: upsampled mask shape mismatch. Expected {(n, target_shape[0], target_shape[1])}, got {result.shape}")
            return masks

        return result
    except Exception as e:
        print(f"Warning: error upscaling masks: {e}, falling back to original masks")
        return masks


def process_mask_numpy(protos, masks_in, bboxes, shape, upsample=False):
    """
    Process masks using numpy.
    Numpy version of process_mask from utils/segment/general.py.

    Args:
        protos: numpy array or torch tensor [c, mh, mw] - prototype masks
        masks_in: numpy array or torch tensor [n, c] - mask coefficients
        bboxes: numpy array or torch tensor [n, 4] - bbox coords [x1, y1, x2, y2]
        shape: tuple (ih, iw) - input image size (height, width)
        upsample: bool - whether to upsample masks to image size

    Returns:
        numpy array [n, ih, iw] (or [n, mh, mw] if upsample=False) - binary masks
    """

    c, mh, mw = protos.shape  # prototype: CHW
    ih, iw = shape  # input image: height, width

    # Validate inputs
    if masks_in.shape[0] == 0:
        print(f"Warning: empty masks_in shape: {masks_in.shape}")
        return np.zeros((0, ih if upsample else mh, iw if upsample else mw), dtype=bool)

    if masks_in.shape[1] != c:
        print(f"Warning: masks_in shape mismatch: expected [:, {c}], got {masks_in.shape}")
        return np.zeros((0, ih if upsample else mh, iw if upsample else mw), dtype=bool)

    # Flatten protos for matrix multiplication: [c, mh, mw] -> [c, mh*mw]
    protos_flat = protos.reshape(c, -1)

    # Matrix multiplication: [n, c] @ [c, mh*mw] = [n, mh*mw]
    masks_flat = masks_in @ protos_flat

    # Apply sigmoid and reshape: [n, mh*mw] -> [n, mh, mw]
    masks = (1 / (1 + np.exp(-masks_flat))).reshape(-1, mh, mw)

    # Scale bboxes from image coordinates to mask coordinates
    downsampled_bboxes = bboxes.copy()
    downsampled_bboxes[:, 0] *= mw / iw  # x1
    downsampled_bboxes[:, 2] *= mw / iw  # x2
    downsampled_bboxes[:, 3] *= mh / ih  # y2
    downsampled_bboxes[:, 1] *= mh / ih  # y1

    # Crop masks to bounding boxes
    masks = crop_mask_numpy(masks, downsampled_bboxes)

    # Upsample to image size if requested
    if upsample:
        masks = _upsample_bilinear(masks, shape)

    # Binarize masks with threshold 0.5
    return (masks > 0.5)


def masks2segments_numpy(masks):
    """
    Convert binary masks to segment contours (list of points).
    Returns all contours for each mask (multiple polygons possible).

    Args:
        masks: numpy array [n, h, w] - binary masks (True/False or 0/1)

    Returns:
        List of lists of numpy arrays. Each inner list contains contours for one mask,
        where each contour has shape [num_points, 2] containing contour points [x, y]
    """
    segments = []
    for mask in masks:
        # Convert to uint8 for cv2
        mask_uint8 = (mask * 255).astype(np.uint8)

        # Find contours
        contours, _ = cv2.findContours(
            mask_uint8,
            mode=cv2.RETR_EXTERNAL,  # only outer contours
            method=cv2.CHAIN_APPROX_SIMPLE  # simplified contours
        )

        mask_contours = []
        for contour in contours:
            # Squeeze to remove extra dimension and convert to [x, y] format
            contour = contour.squeeze().astype(np.float32)
            # cv2 returns [x, y], ensure shape is [n, 2]
            if len(contour.shape) == 1:
                contour = contour.reshape(1, -1)
            mask_contours.append(contour)

        # If no contours found, add empty list
        segments.append(mask_contours if mask_contours else [np.array([], dtype=np.float32).reshape(0, 2)])

    return segments


def masks2polygons_numpy(masks):
    """
    Convert binary masks to polygon points for plotting.

    Args:
        masks: numpy array [n, h, w] - binary masks (True/False or 0/1)

    Returns:
        List of lists, each containing [x, y] coordinates as a flat list suitable for drawing
        Format: [[[x1, y1], [x2, y2], ...], ...] or [[x1, y1, x2, y2, ...], ...]
    """
    segments = masks2segments_numpy(masks)
    # Convert to list of [x, y] pairs
    return [segment.tolist() for segment in segments]


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
    area1 = (box1[:, 2] - box1[:, 0]) * (box1[:, 3] - box1[:, 1])
    area2 = (box2[:, 2] - box2[:, 0]) * (box2[:, 3] - box2[:, 1])

    iou = np.zeros((len(box1), len(box2)), dtype=np.float32)

    for i in range(len(box1)):
        for j in range(len(box2)):
            inter_x1 = np.maximum(box1[i, 0], box2[j, 0])
            inter_y1 = np.maximum(box1[i, 1], box2[j, 1])
            inter_x2 = np.minimum(box1[i, 2], box2[j, 2])
            inter_y2 = np.minimum(box1[i, 3], box2[j, 3])

            inter_w = np.maximum(0, inter_x2 - inter_x1)
            inter_h = np.maximum(0, inter_y2 - inter_y1)
            inter_area = inter_w * inter_h

            union = area1[i] + area2[j] - inter_area
            iou[i, j] = inter_area / union if union > 0 else 0

    return iou


def nms(boxes, scores, iou_thres):
    """Non-Maximum Suppression implementation in NumPy"""
    if len(boxes) == 0:
        return np.array([], dtype=np.int32)

    indices = np.argsort(-scores)

    keep = []
    while len(indices) > 0:
        i = indices[0]
        keep.append(i)

        if len(indices) == 1:
            break

        iou_scores = box_iou(boxes[indices[0:1]], boxes[indices[1:]])[0]

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
        nm=0,
):
    """Non-Maximum Suppression (NMS) on inference results to reject overlapping detections

    Returns:
         list of detections, on (n,6) tensor per image [xyxy, conf, cls]
    """

    if isinstance(prediction, (list, tuple)):
        prediction = prediction[0]

    bs = prediction.shape[0]
    nc = prediction.shape[1] - nm - 4
    mi = 4 + nc
    xc = np.max(prediction[:, 4:mi], axis=1) > conf_thres

    assert 0 <= conf_thres <= 1, f'Invalid Confidence threshold {conf_thres}, valid values are between 0.0 and 1.0'
    assert 0 <= iou_thres <= 1, f'Invalid IoU {iou_thres}, valid values are between 0.0 and 1.0'

    max_wh = 7680
    max_nms = 30000
    time_limit = 2.5 + 0.05 * bs
    redundant = True
    multi_label &= nc > 1
    merge = False

    t = time.time()
    output = [np.zeros((0, 6 + nm), dtype=np.float32)] * bs
    for xi, pred_x in enumerate(prediction):
        x = pred_x.T[xc[xi]]

        if labels and len(labels[xi]):
            lb = labels[xi]
            v = np.zeros((len(lb), nc + nm + 5), dtype=x.dtype)
            v[:, :4] = lb[:, 1:5]
            v[np.arange(len(lb)), lb[:, 0].astype(int) + 4] = 1.0
            x = np.concatenate((x, v), 0)

        if x.shape[0] == 0:
            continue

        box = x[:, :4]
        cls = x[:, 4:4 + nc]
        mask = x[:, 4 + nc:] if nm > 0 else np.zeros((x.shape[0], nm), dtype=x.dtype)

        box = xywh2xyxy(box)

        if multi_label:
            i, j = np.where(cls > conf_thres)
            x = np.concatenate((box[i], x[i, 4 + j][:, None], j[:, None].astype(np.float32), mask[i]), 1)
        else:
            j = np.argmax(cls, axis=1, keepdims=True)
            conf = cls[np.arange(len(cls)), j.flatten()][:, None]
            x = np.concatenate((box, conf, j.astype(np.float32), mask), 1)[conf.flatten() > conf_thres]

        if classes is not None:
            class_tensor = np.array(classes, dtype=np.float32)
            mask = np.any(x[:, 5:6] == class_tensor, axis=1)
            x = x[mask]

        n = x.shape[0]
        if n == 0:
            continue
        elif n > max_nms:
            x = x[x[:, 4].argsort()[::-1][:max_nms]]
        else:
            x = x[x[:, 4].argsort()[::-1]]

        c = x[:, 5:6] * (0 if agnostic else max_wh)
        boxes, scores = x[:, :4] + c, x[:, 4]
        i = nms(boxes, scores, iou_thres)
        if i.shape[0] > max_det:
            i = i[:max_det]
        if merge and (1 < n < 3E3):
            iou = box_iou(boxes[i], boxes) > iou_thres
            weights = iou * scores[None]
            x[i, :4] = np.dot(weights, x[:, :4]).astype(np.float32) / weights.sum(1, keepdims=True)
            if redundant:
                i = i[iou.sum(1) > 1]

        output[xi] = x[i]
        if (time.time() - t) > time_limit:
            import warnings
            warnings.warn(f'WARNING ⚠️ NMS time limit {time_limit:.3f}s exceeded')
            break

    return output