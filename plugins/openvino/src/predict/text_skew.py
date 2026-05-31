from typing import List, Tuple
import math

BoundingBox = Tuple[int, int, int, int]


def union_boxes(boxes: List[BoundingBox]) -> BoundingBox:
    left = min([box[0] for box in boxes])
    top = min([box[1] for box in boxes])
    right = max([box[0] + box[2] for box in boxes])
    bottom = max([box[1] + box[3] for box in boxes])
    return left, top, right - left, bottom - top


def are_boxes_adjacent(box1: BoundingBox, box2: BoundingBox):
    l1, t1, w1, h1 = box1
    l2, t2, w2, h2 = box2

    line_slop = 2 / 3
    if t1 > t2 + h2 * line_slop or t2 > t1 + h1 * line_slop:
        return False

    # Calculate the left and right edges of each box
    left_edge_box1 = l1
    right_edge_box1 = l1 + w1
    left_edge_box2 = l2
    right_edge_box2 = l2 + w2

    # Determine the larger height between the two boxes
    larger_height = max(h1, h2)

    threshold = larger_height * 2

    # Calculate the vertical distance between the boxes
    distance = min(
        abs(left_edge_box1 - right_edge_box2), abs(left_edge_box2 - right_edge_box1)
    )

    # Check if the boxes are adjacent along their left or right sides
    if distance <= threshold:
        return True
    else:
        return False


def find_adjacent_groups(boxes: List[BoundingBox], scores: List[float]) -> List[dict]:
    groups = []

    # sort boxes left to right
    boxes = sorted(boxes, key=lambda box: box[0])

    for index, box in enumerate(boxes):
        added_to_group = False
        for group in groups:
            for other_box in group["boxes"]:
                if are_boxes_adjacent(box, other_box):
                    group["boxes"].append(box)
                    group["scores"].append(scores[index])
                    added_to_group = True
                    break
            if added_to_group:
                break
        if not added_to_group:
            groups.append({"boxes": [box], "scores": [scores[index]]})

    # Calculate the skew angle of each group
    for group in groups:
        boxes = group["boxes"]
        group["union"] = union_boxes(boxes)
        if len(boxes) - 1:
            lm = boxes[0][1] + boxes[0][3] / 2
            rm = boxes[-1][1] + boxes[-1][3] / 2
            dx = (boxes[-1][0]) - (boxes[0][0])
            minx = min([box[0] for box in boxes])
            maxx = max([box[0] + box[2] for box in boxes])

            # denoise by filtering the box height
            minh = min([box[3] for box in boxes])
            median_height = sorted([box[3] for box in boxes])[len(boxes) // 2]
            maxh = max([box[3] for box in boxes])
            filter_height = median_height
            pad_height = filter_height * 0.05

            dx = maxx - minx
            group['skew_angle'] = math.atan((rm - lm) / dx)
            group['deskew_height'] = filter_height + pad_height * 2
            # pad this box by a few pixels
            group['union'] = (
                group['union'][0] - pad_height,
                group['union'][1] - pad_height,
                group['union'][2] + pad_height * 2,
                group['union'][3] + pad_height * 2)
            # average the scores
            group['score'] = sum(group['scores']) / len(group['scores'])
        else:
            group['skew_angle'] = 0
            group['deskew_height'] = boxes[0][3]
            group['score'] = group['scores'][0]

    return groups
