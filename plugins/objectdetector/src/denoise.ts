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

export interface DenoisedDetectionState<T> {
    previousDetections?: DenoisedDetectionEntry<T>[];
    frameCount?: number;
    lastDetection?: number;
    // id to time
    externallyTracked?: Map<string, DenoisedDetectionEntry<T>>;
}

export function denoiseDetections<T>(state: DenoisedDetectionState<T>,
    currentDetections: DenoisedDetectionEntry<T>[],
    options?: DenoisedDetectionOptions<T>
) {
    if (!state.previousDetections)
        state.previousDetections = [];

    const now = options.now || Date.now();
    const lastDetection = state.lastDetection || now;
    const sinceLastDetection = now - lastDetection;

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
