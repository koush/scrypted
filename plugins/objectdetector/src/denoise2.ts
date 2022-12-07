const Tracker = require('node-moving-things-tracker').Tracker;
import { DenoisedDetectionEntry, DenoisedDetectionOptions, DenoisedDetectionState, TrackedItem, TrackerItem } from './denoise';

export function denoiseDetections2<T>(state: DenoisedDetectionState<T>,
    currentDetections: DenoisedDetectionEntry<T>[],
    options?: DenoisedDetectionOptions<T>
) {
    if (!state.tracker) {
        state.frameCount = 0;
        const tracker = Tracker.newTracker();
        tracker.reset();
        tracker.setParams({
            fastDelete: true,
            unMatchedFramesTolerance: Number.MAX_SAFE_INTEGER,
            iouLimit: 0.05
        });
        state.tracker = tracker;
    }

    if (!state.previousDetections)
        state.previousDetections = [];

    const { tracker, previousDetections } = state;

    const items: TrackerItem<T>[] = currentDetections.filter(cd => cd.boundingBox).map(cd => {
        const [x, y, w, h] = cd.boundingBox;
        return {
            x, y, w, h,
            confidence: cd.score,
            name: cd.name,
        }
    });

    tracker.updateTrackedItemsWithNewFrame(items, state.frameCount);
    // console.log(tracker.getAllTrackedItems());
    const afterItems: TrackedItem<T>[] = [...tracker.getTrackedItems().values()];

    const now = options.now || Date.now();

    const lastDetection = state.lastDetection || now;
    const sinceLastDetection = now - lastDetection;
    const previousCopy = previousDetections.slice();
    previousDetections.splice(0, previousDetections.length);
    const map = new Map<string, DenoisedDetectionEntry<T>>();
    for (const pd of previousCopy) {
        map.set(pd.id, pd);
    }

    for (const a of afterItems) {
        map.delete(a.id);

        const previous = previousCopy.find(d => d.id === a.id);
        const current = currentDetections.find(d => {
            const [x, y, w, h] = d.boundingBox;
            return !d.id && x === a.x && y === a.y && w === a.w && h === a.h;
        });

        if (current) {
            current.id = a.id;
            current.lastSeen = now;
            current.durationGone = 0;
            if (previous) {
                current.firstSeen = previous.lastSeen;
                previous.lastSeen = now;
                previous.durationGone = 0;
                options.retained?.(current, previous);
            }
            else {
                current.firstSeen = now;
                options.added?.(current);
            }

            previousDetections.push(current);
        }
        else if (previous) {
            previous.durationGone += sinceLastDetection;
            if (previous.durationGone >= options.timeout) {
                a.frameUnmatchedLeftBeforeDying = -1;
            }   
            else {
                options.expiring?.(previous);
                previousDetections.push(previous);
            }
        }
        else {
            console.warn('unprocessed denoised detection?', a);
        }
    }

    // should never reach here?
    for (const r of map.values()) {
        options.removed?.(r)
    }

    state.tracked = afterItems;
    state.lastDetection = now;
    state.frameCount++;
}
