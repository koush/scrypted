
export class DenoisedDetectionEntry<T> {
    id?: string;
    boundingBox?: [number, number, number, number];
    name: string;
    detection: T;

    firstSeen?: number;
    lastSeen?: number;
    durationGone?: number;
}

export interface DenoisedDetectionOptions<T> {
    added?: (detection: DenoisedDetectionEntry<T>) => void;
    removed?: (detection: DenoisedDetectionEntry<T>) => void;
    retained?: (detection: DenoisedDetectionEntry<T>) => void;
    timeout?: number;
    now?: number;
}

export interface DenoisedDetectionState<T> {
    previousDetections?: DenoisedDetectionEntry<T>[];
    lastDetection?: number;
}

function getCenterAndAndArea(boundingBox: [number, number, number, number]) {
    const area = boundingBox[2] * boundingBox[3];
    const cx = boundingBox[0] + boundingBox[2] / 2;
    const cy = boundingBox[1] + boundingBox[3] / 2;
    return {
        area,
        center: [cx, cy],
    }
}

function createBoundingBoxScorer(boundingBox: [number, number, number, number]) {
    const { center, area } = getCenterAndAndArea(boundingBox);

    return (other: [number, number, number, number]) => {
        const { center: otherCenter, area: otherArea } = getCenterAndAndArea(other);
        const ad = Math.min(otherArea / area, area / otherArea) || 0;
        const d = Math.sqrt(Math.pow(otherCenter[0] - center[0], 2) + Math.pow(otherCenter[1] - center[1], 2)) / Math.sqrt(2);
        // return d + ad;
        return d;
    }
}

export function denoiseDetections<T>(state: DenoisedDetectionState<T>,
    currentDetections: DenoisedDetectionEntry<T>[],
    options?: DenoisedDetectionOptions<T>
) {
    if (!state.previousDetections)
        state.previousDetections = [];

    const { previousDetections } = state;

    const now = options?.now || Date.now();
    const newAndExisting: DenoisedDetectionEntry<T>[] = [];
    for (const cd of currentDetections) {
        let index = -1;
        if (cd.id)
            index = previousDetections.findIndex(d => d.id === cd.id);
        if (index === -1 && cd.boundingBox) {
            const scorer = createBoundingBoxScorer(cd.boundingBox);
            const boxed = previousDetections.filter(d => !!d.boundingBox);
            if (boxed.length) {
                boxed.sort((d1, d2) => scorer(d1.boundingBox) - scorer(d2.boundingBox));
                let best: DenoisedDetectionEntry<T>;
                for (const check of boxed) {
                    const reverseScorer = createBoundingBoxScorer(check.boundingBox);
                    const list = currentDetections.slice().filter(d => !!d.boundingBox);
                    const reversed = list.sort((d1, d2) => reverseScorer(d1.boundingBox) - reverseScorer(d2.boundingBox));
                    if (reversed[0] === cd) {
                        best = check;
                        break;
                    }
                }
            }
        }
        if (index === -1)
            index = previousDetections.findIndex(d => d.name === cd.name);
        if (index === -1) {
            cd.firstSeen = now;
            cd.lastSeen = now;
            cd.durationGone = 0;
            newAndExisting.push(cd);
            options?.added?.(cd);
        }
        else {
            const [found] = previousDetections.splice(index, 1);
            cd.firstSeen = found.firstSeen;
            cd.lastSeen = now;
            cd.durationGone = 0;
            newAndExisting.push(cd);
            options?.retained?.(found);
        }
    }

    const lastDetection = state.lastDetection || now;
    const sinceLastDetection = now - lastDetection;
    const purgeTime = options?.timeout || 10000;
    // anything remaining in previousDetections at this point has possibly left the scene.
    for (const cd of previousDetections.slice()) {
        cd.durationGone += sinceLastDetection;
        if (cd.durationGone < purgeTime)
            continue;
        const index = previousDetections.findIndex(check => check === cd);
        if (index !== -1)
            previousDetections.splice(index, 1);
        options?.removed?.(cd);
    }

    // add all the detections that are pending removal
    newAndExisting.push(...previousDetections);

    // clear it out
    previousDetections.splice(0, previousDetections.length);

    previousDetections.push(...newAndExisting);

    state.lastDetection = now;
}
