from collections import namedtuple

Rectangle = namedtuple('Rectangle', 'xmin ymin xmax ymax')

def intersect_rect(a: Rectangle, b: Rectangle):
    x1 = max(min(a.xmin, a.xmax), min(b.xmin, b.xmax))
    y1 = max(min(a.ymin, a.ymax), min(b.ymin, b.ymax))
    x2 = min(max(a.xmin, a.xmax), max(b.xmin, b.xmax))
    y2 = min(max(a.ymin, a.ymax), max(b.ymin, b.ymax))
    if x1<x2 and y1<y2:
        return Rectangle(x1, y1, x2, y2)

def combine_rect(a: Rectangle, b: Rectangle):
    return Rectangle(min(a.xmin, b.xmin), min(a.ymin, b.ymin), max(a.xmax, b.xmax), max(a.ymax, b.ymax))

def intersect_area(a: Rectangle, b: Rectangle):
    intersect = intersect_rect(a, b)
    if intersect:
        dx = intersect.xmax - intersect.xmin
        dy = intersect.ymax - intersect.ymin
        return dx * dy

def to_bounding_box(rect: Rectangle):
    return (rect.xmin, rect.ymin, rect.xmax - rect.xmin, rect.ymax - rect.ymin)

def from_bounding_box(bb):
    return Rectangle(bb[0], bb[1], bb[0] + bb[2], bb[1] + bb[3])
