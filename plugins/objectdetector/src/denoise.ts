const Tracker = require('node-moving-things-tracker').Tracker;

export class DenoisedDetectionEntry<T> {
    id?: string;
    boundingBox?: [number, number, number, number];
    name: string;
    score: number;
    detection: T;

    firstSeen?: number;
    firstBox?: [number, number, number, number];
    lastSeen?: number;
    lastBox?: [number, number, number, number];
    durationGone?: number;
}

export interface DenoisedDetectionOptions<T> {
    added?: (detection: DenoisedDetectionEntry<T>) => void;
    removed?: (detection: DenoisedDetectionEntry<T>) => void;
    retained?: (detection: DenoisedDetectionEntry<T>, previous: DenoisedDetectionEntry<T>) => void;
    untracked?: (detection: DenoisedDetectionOptions<T>) => void,
    expiring?: (previous: DenoisedDetectionEntry<T>) => void;
    timeout?: number;
    now?: number;
}

export interface TrackerItem<T> {
    x: number,
    y: number,
    w: number,
    h: number,
    confidence: number,
    name: string,
};

export interface TrackedItem<T> extends TrackerItem<T> {
    id: string;
    isZombie: boolean;
    bearing: number;
    frameUnmatchedLeftBeforeDying: number;
    velocity: {
        dx: number,
        dy: number,
    }
}

export interface DenoisedDetectionState<T> {
    previousDetections?: DenoisedDetectionEntry<T>[];
    tracker?: any;
    tracked?: TrackedItem<T>[];
    frameCount?: number;
    lastDetection?: number;
    // id to time
    externallyTracked?: Map<string, DenoisedDetectionEntry<T>>;
}

type Rectangle = {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
};

function intersect_area(a: Rectangle, b: Rectangle) {
    const dx = Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin)
    const dy = Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin)
    if (dx >= 0 && dy >= 0)
        return dx * dy
}

function trackedItemToRectangle(item: TrackedItem<any>): Rectangle {
    return {
        xmin: item.x,
        xmax: item.x + item.w,
        ymin: item.y,
        ymax: item.y + item.h,
    };
}

export function denoiseDetections<T>(state: DenoisedDetectionState<T>,
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

    const now = options.now || Date.now();
    const lastDetection = state.lastDetection || now;
    const sinceLastDetection = now - lastDetection;

    const externallyTracked = currentDetections.filter(d => d.id);
    if (externallyTracked.length) {
        if (!state.externallyTracked)
            state.externallyTracked = new Map();

        for (const tracked of currentDetections) {
            tracked.durationGone = 0;
            tracked.lastSeen = now;
            tracked.lastBox = tracked.boundingBox;

            if (!tracked.id) {
                const id = tracked.id = `untracked-${tracked.name}`;
                if (!state.externallyTracked.get(id)) {
                    // crappy track untracked objects for 1 minute.
                    setTimeout(() => state.externallyTracked.delete(id), 60000);
                }
            }

            let previous = state.externallyTracked.get(tracked.id);
            if (previous) {
                state.externallyTracked.delete(tracked.id);
                tracked.firstSeen = previous.firstSeen;
                tracked.firstBox = previous.firstBox;

                previous.durationGone = 0;
                previous.lastSeen = now;
                previous.lastBox = tracked.boundingBox;
                options?.retained(tracked, previous);
            }
            else {
                tracked.firstSeen = now;
                tracked.firstBox = tracked.lastBox = tracked.boundingBox;
                options?.added(tracked);
            }

        }

        for (const previous of state.externallyTracked.values()) {
            if (now - previous.lastSeen) {
                previous.durationGone += sinceLastDetection;
                if (previous.durationGone >= options.timeout) {
                    options?.expiring(previous);
                }
            }
        }

        for (const tracked of currentDetections) {
            state.externallyTracked.set(tracked.id, tracked);
        }
    }

    if (state.externallyTracked)
        return;

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
    const trackedObjects: TrackedItem<T>[] = [...tracker.getTrackedItems().values()];
    // for (const to of trackedObjects) {
    //     console.log(to.velocity);
    // }


    const previousCopy = previousDetections.slice();
    previousDetections.splice(0, previousDetections.length);
    const map = new Map<string, DenoisedDetectionEntry<T>>();
    for (const pd of previousCopy) {
        map.set(pd.id, pd);
    }

    for (const trackedObject of trackedObjects) {
        map.delete(trackedObject.id);

        const previous = previousCopy.find(d => d.id === trackedObject.id);
        const current = currentDetections.find(d => {
            const [x, y, w, h] = d.boundingBox;
            return !d.id && x === trackedObject.x && y === trackedObject.y && w === trackedObject.w && h === trackedObject.h;
        });

        if (current) {
            current.id = trackedObject.id;
            current.lastSeen = now;
            current.durationGone = 0;
            if (previous) {
                previous.lastSeen = now;
                current.firstSeen = previous.firstSeen;
                current.firstBox = previous.firstBox;
                current.lastBox = previous.boundingBox;
                previous.lastBox = current.boundingBox;
                previous.durationGone = 0;
                options.retained?.(current, previous);
            }
            else {
                current.firstSeen = now;
                current.firstBox = current.boundingBox;
                current.lastBox = current.boundingBox;
                options.added?.(current);
            }

            previousDetections.push(current);
        }
        else if (previous) {
            previous.durationGone += sinceLastDetection;
            if (previous.durationGone >= options.timeout) {
                let foundContainer = false;
                // the detector may combine multiple detections into one.
                // handle that scenario by not expiring the individual detections that
                // are globbed into a larger one.
                for (const other of trackedObjects) {
                    if (other === trackedObject || other.isZombie)
                        continue;
                    const area = intersect_area(trackedItemToRectangle(trackedObject), trackedItemToRectangle(other));
                    if (area) {
                        const trackedObjectArea = trackedObject.w * trackedObject.h;
                        if (area / trackedObjectArea > .5) {
                            foundContainer = true;
                            break;
                        }
                    }
                }
                if (!foundContainer)
                    trackedObject.frameUnmatchedLeftBeforeDying = -1;
                // else
                //     console.log('globbed!');
            }
            else {
                options.expiring?.(previous);
                previousDetections.push(previous);
            }
        }
        else {
            // console.warn('unprocessed denoised detection?', trackedObject);
        }
    }

    // should never reach here?
    for (const r of map.values()) {
        options.removed?.(r)
    }

    state.tracked = trackedObjects;
    state.lastDetection = now;
    state.frameCount++;
}
