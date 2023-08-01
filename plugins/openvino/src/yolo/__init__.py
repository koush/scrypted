import sys
from math import exp
import numpy as np

from predict import Prediction, Rectangle

defaultThreshold = .2

def parse_yolov8(results, threshold = defaultThreshold, scale = None, confidence_scale  = None):
    objs = []
    keep = np.argwhere(results[4:] > threshold)
    for indices in keep:
        class_id = indices[0]
        index = indices[1]
        confidence = results[class_id + 4, index].astype(float)
        x = results[0][index].astype(float)
        y = results[1][index].astype(float)
        w = results[2][index].astype(float)
        h = results[3][index].astype(float)
        if scale:
            x = scale(x)
            y = scale(y)
            w = scale(w)
            h = scale(h)
        if confidence_scale:
            confidence = confidence_scale(confidence)
        obj = Prediction(
            int(class_id),
            confidence,
            Rectangle(
                x - w / 2,
                y - h / 2,
                x + w / 2,
                y + h / 2,
            ),
        )
        objs.append(obj)

    return objs

def sig(x):
    return 1/(1 + np.exp(-x))

def intersection_over_union(box_1, box_2):
    width_of_overlap_area = min(box_1['xmax'], box_2['xmax']) - max(box_1['xmin'], box_2['xmin'])
    height_of_overlap_area = min(box_1['ymax'], box_2['ymax']) - max(box_1['ymin'], box_2['ymin'])
    if width_of_overlap_area < 0 or height_of_overlap_area < 0:
        area_of_overlap = 0
    else:
        area_of_overlap = width_of_overlap_area * height_of_overlap_area
    box_1_area = (box_1['ymax'] - box_1['ymin']) * (box_1['xmax'] - box_1['xmin'])
    box_2_area = (box_2['ymax'] - box_2['ymin']) * (box_2['xmax'] - box_2['xmin'])
    area_of_union = box_1_area + box_2_area - area_of_overlap
    if area_of_union == 0:
        return 0
    return area_of_overlap / area_of_union

def scale_bbox(x, y, h, w, class_id, confidence, h_scale, w_scale):
    """scale = np.array([min(w_scale/h_scale, 1), min(h_scale/w_scale, 1)])
    offset = 0.5*(np.ones(2) - scale)
    x, y = (np.array([x, y]) - offset) / scale
    width, height = np.array([w, h]) / scale"""
    #print(f"x{x}, y{y}, w{w}, h{h}")
    xmin = int((x - w / 2) * w_scale)
    ymin = int((y - h / 2) * h_scale)
    xmax = int(xmin + w * w_scale)
    ymax = int(ymin + h * h_scale)

    print(f"x{xmin}, y{ymin}, xm{xmax}, ym{ymax}")
    return dict(xmin=xmin, xmax=xmax, ymin=ymin, ymax=ymax, class_id=class_id, confidence=confidence)


def parse_yolo_region(blob, original_im_shape, anchors, sigmoid = True):
    # ------------------------------------------ Validating output parameters ------------------------------------------
    _, c1, c2, c3 = blob.shape   # [26, 26] and [13, 13]
    if c1 == 255:
        out_blob_h, out_blob_w = c2, c3
        i_oth = 1
        i_r = 2
        i_c = 3
    else:
        i_oth = 3
        i_r = 1
        i_c = 2
        out_blob_h, out_blob_w = c1, c2

    assert out_blob_w == out_blob_h, "Invalid size of output blob. It sould be in NCHW layout and height should " \
                                     "be equal to width. Current height = {}, current width = {}" \
                                     "".format(out_blob_h, out_blob_w)

    # ------------------------------------------ Extracting layer parameters -------------------------------------------
    #print(f"predictions shape{blob.shape}")
    orig_im_h, orig_im_w = original_im_shape    # 416
    objects = list()

    cell_w = orig_im_w / out_blob_w
    cell_h = orig_im_h / out_blob_h

    for oth in range(0, blob.shape[i_oth], 85):    # 255
        for row in range(blob.shape[i_r]):       # 13
            for col in range(blob.shape[i_c]):   # 13
                #print(f"l {l}")
                if i_oth == 3:
                    info_per_anchor = blob[0, row, col, oth:oth+85] #print("prob"+str(prob))
                else:
                    info_per_anchor = blob[0, oth:oth+85, row, col] #print("prob"+str(prob))

                confidences = info_per_anchor[5:]
                if sigmoid:
                    confidences = [sig(raw) for raw in confidences]
                class_id = np.argmax(confidences)

                rel_cell_x, rel_cell_y, width, height, box_confidence = info_per_anchor[:5]
                if sigmoid:
                    box_confidence = sig(box_confidence)
                if box_confidence < .2:
                    continue

                confidence = confidences[class_id]
                if confidence < .2:
                    continue

                if sigmoid:
                    rel_cell_x = sig(rel_cell_x)
                    rel_cell_y = sig(rel_cell_y)

                x = (col + rel_cell_x) * cell_w
                y = (row + rel_cell_y) * cell_h

                n = int(oth/85)

                try:
                    width = exp(width)
                    height = exp(height)
                except OverflowError:
                    continue

                width = width * anchors[2 * n]
                height = height * anchors[2 * n + 1]

                xmin = x - width / 2
                xmax = x + width / 2
                ymin = y - height / 2
                ymax = y + height /2 
                objects.append(
                    {
                        'xmin': xmin.astype(float),
                        'xmax': xmax.astype(float),
                        'ymin': ymin.astype(float),
                        'ymax': ymax.astype(float),
                        'confidence': confidence.astype(float),
                        'classId': class_id.astype(float),
                    }
                )

    # Filtering overlapping boxes with respect to the --iou_threshold CLI parameter
    objects = sorted(objects, key=lambda obj : obj['confidence'], reverse=True)
    for i in range(len(objects)):
        if objects[i]['confidence'] == 0:
            continue
        for j in range(i + 1, len(objects)):
            if objects[i]['classId'] != objects[j]['classId']:
                continue
            if intersection_over_union(objects[i], objects[j]) > .2:
                objects[j]['confidence'] = 0

    objects = list(filter(lambda o: o['confidence'] > 0, objects))
    return objects
