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
            unMatchedFramesTolerance: (options.timeout / 1000) || 30,
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
            detection: cd,
        }
    });

    tracker.updateTrackedItemsWithNewFrame(items, state.frameCount);
    // console.log(tracker.getAllTrackedItems());
    const afterItems: TrackedItem<T>[] = [...tracker.getTrackedItems().values()];

    const now = options.now || Date.now();
    const beforeItems: TrackedItem<T>[] = state.tracked || [];

    const lastDetection = state.lastDetection || now;
    const sinceLastDetection = now - lastDetection;

    const map = new Map<string, TrackedItem<T>>();
    for (const b of beforeItems) {
        map.set(b.id, b);
    }
    for (const a of afterItems) {
        a.detection.id = a.id;

        if (!map.has(a.id)) {
            a.detection.id = a.id;
            a.detection.firstSeen = now;
            a.detection.lastSeen = now;
            a.detection.durationGone = 0;

            options.added?.(a.detection);
        }
        else {
            const b = map.get(a.id);
            map.delete(a.id);

            if (!a.isZombie) {
                a.detection.firstSeen = b.detection.firstSeen;
                a.detection.lastSeen = now;
                a.detection.durationGone = 0;

                options.retained?.(a.detection, b.detection)
            }
            else {
                a.detection.durationGone += sinceLastDetection;
            }
        }
    }

    for (const r of map.values()) {
        options.removed?.(r.detection)
    }

    state.tracked = afterItems;
    state.lastDetection = now;
    state.frameCount++;

    // clear it out
    previousDetections.splice(0, previousDetections.length);
    const newAndExisting = afterItems.map(a => a.detection);
    previousDetections.push(...newAndExisting);
}
