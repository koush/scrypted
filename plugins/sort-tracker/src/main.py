from __future__ import annotations

from sort_oh import tracker
import scrypted_sdk
from scrypted_sdk.types import (ObjectDetectionResult)
import numpy as np
from rectangle import Rectangle, intersect_area

def create_scrypted_plugin():
    return SortOHTracker()

class SortOHTracker(scrypted_sdk.ObjectTracker):
    def __init__(self) -> None:
        super().__init__()
        self.trackers = {}

    def trackObjects(self, ret: scrypted_sdk.ObjectsDetected):
        detections = ret['detections']
        id = ret['detectionId']
        detectionTracker = self.trackers.get(id)
        iw, ih = ret['inputDimensions']
        if not detectionTracker:
            detectionTracker = tracker.Sort_OH(scene=np.array([iw, ih]))
            # t.conf_three_frame_certainty = (settings.get('trackerCertainty') or .2) * 3
            # t.conf_unmatched_history_size = settings.get('trackerWindow') or 3
            self.trackers[id] = detectionTracker

        sort_input = []
        for d in detections:
            r: ObjectDetectionResult = d
            l, t, w, h = r['boundingBox']
            sort_input.append([l, t, l + w, t + h, r['score']])

        trackers, unmatched_trckr, unmatched_gts = detectionTracker.update(
            np.array(sort_input), [])

        for td in trackers:
            x0, y0, x1, y1, trackID = td[0].item(), td[1].item(
            ), td[2].item(), td[3].item(), td[4].item()
            slop = 0
            obj: ObjectDetectionResult = None
            ta = (x1 - x0) * (y1 - y0)
            box = Rectangle(x0, y0, x1, y1)
            for d in detections:
                if d.get('id'):
                    continue
                ob: ObjectDetectionResult = d
                dx0, dy0, dw, dh = ob['boundingBox']
                dx1 = dx0 + dw
                dy1 = dy0 + dh
                da = dw * dh
                area = intersect_area(Rectangle(dx0, dy0, dx1, dy1), box)
                if not area:
                    continue
                # intersect area always gonna be smaller than
                # the detection or tracker area.
                # greater numbers, ie approaching 2, is better.
                dslop = area / ta + area / da
                if (dslop > slop):
                    slop = dslop
                    obj = ob

            if obj:
                obj['id'] = str(trackID)

        return ret
