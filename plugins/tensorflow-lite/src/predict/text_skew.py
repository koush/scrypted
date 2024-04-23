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


def find_adjacent_groups(boxes: List[BoundingBox]) -> List[dict]:
    groups = []

    # sort boxes left to right
    boxes = sorted(boxes, key=lambda box: box[0])

    for box in boxes:
        added_to_group = False
        for group in groups:
            for other_box in group["boxes"]:
                if are_boxes_adjacent(box, other_box):
                    group["boxes"].append(box)
                    added_to_group = True
                    break
            if added_to_group:
                break
        if not added_to_group:
            groups.append({"boxes": [box], "skew_angle": 0})

    # Calculate the skew angle of each group
    for group in groups:
        boxes = group["boxes"]
        sum_angle = 0
        if len(boxes) -1 :
            lm = (boxes[0][1] + boxes[0][3]) / 2
            rm = (boxes[-1][1] + boxes[-1][3]) / 2
            group['skew_angle'] = math.atan2(rm - lm, boxes[-1][0] - boxes[0][0])
        else:
            group['skew_angle'] = 0

        for i in range(len(boxes) - 1):
            x1, y1, w1, h1 = boxes[i]
            x2, y2, w2, h2 = boxes[i + 1]
            dx = x2 - x1
            dy = y2 - y1
            sum_angle += math.atan2(dy, dx)
        # group["skew_angle"] = 0 if not len(boxes) - 1 else sum_angle / (len(boxes) - 1)
        group["union"] = union_boxes(boxes)

    return groups
