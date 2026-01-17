"""
YOLOv9 Segmentation Parser - Numpy Implementation

This module provides pure numpy implementations of mask processing functions
that are equivalent to their torch counterparts in utils/segment/general.py.
"""

import numpy as np
import cv2

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
    x1 = boxes[:, 0][:, None, None]  # (n, 1, 1)
    y1 = boxes[:, 1][:, None, None]  # (n, 1, 1)
    x2 = boxes[:, 2][:, None, None]  # (n, 1, 1)
    y2 = boxes[:, 3][:, None, None]  # (n, 1, 1)

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
    masks_transposed = masks.transpose(1, 2, 0)  # (h, w, n)
    upsampled = cv2.resize(
        masks_transposed.astype(np.float32),
        (target_shape[1], target_shape[0]),  # cv2 uses (width, height)
        interpolation=cv2.INTER_LINEAR
    )
    return upsampled.transpose(2, 0, 1)  # (n, h, w)


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