
export class DenoisedDetectionEntry<T> {
    id?: string;
    boundingBox?: [number, number, number, number];
    name: string;
    score: number;
    detection: T;

    firstSeen?: number;
    lastSeen?: number;
    durationGone?: number;
}

export interface DenoisedDetectionOptions<T> {
    added?: (detection: DenoisedDetectionEntry<T>) => void;
    removed?: (detection: DenoisedDetectionEntry<T>) => void;
    retained?: (detection: DenoisedDetectionEntry<T>, previous: DenoisedDetectionEntry<T>) => void;
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

    detection: DenoisedDetectionEntry<T>;
};

export interface TrackedItem<T> extends TrackerItem<T> {
    id: string;
    isZombie: boolean;
    bearing: number;
}

export interface DenoisedDetectionState<T> {
    previousDetections?: DenoisedDetectionEntry<T>[];
    tracker?: any;
    tracked?: TrackedItem<T>[];
    frameCount?: number;
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

export function getDetectionAge<T>(d: DenoisedDetectionEntry<T>) {
    let { firstSeen, lastSeen } = d;
    firstSeen ||= 0;
    lastSeen ||= 0;
    return lastSeen - firstSeen;
}

type Matched<T> = {
    r1: DenoisedDetectionEntry<T>;
    r2: DenoisedDetectionEntry<T>;
}

export function matchBoxes<T>(da1: DenoisedDetectionEntry<T>[], da2: DenoisedDetectionEntry<T>[], bestScore = Number.MAX_SAFE_INTEGER, currentScore = 0) {
    if (da1.length === 0 || da2.length === 0) {
        return {
            score: 0,
            matched: [] as Matched<T>[],
        }
    }

    let b: Matched<T>[];
    for (const d1 of da1) {
        const scorer = createBoundingBoxScorer(d1.boundingBox);
        // score all the boxes and sort by best match
        const scored = da2.map(entry => {
            return {
                entry,
                score: scorer(entry.boundingBox),
            }
        }).sort((e1, e2) => e1.score - e2.score);

        for (const { entry: d2 } of scored) {
            const s = scorer(d2.boundingBox);
            if (currentScore + s >= bestScore)
                continue;
            const df1 = da1.filter(c => c !== d1);
            const df2 = da2.filter(c => c !== d2);
            const m = matchBoxes(df1, df2, bestScore, currentScore + s);
            if (!m)
                continue;
            const { score, matched } = m;
            bestScore = currentScore + score + s;
            b = matched;
            b.push({
                r1: d1,
                r2: d2,
            });
        }
    }

    if (!b)
        return undefined;

    return {
        score: bestScore,
        matched: b,
    }
}

export function denoiseDetections<T>(state: DenoisedDetectionState<T>,
    currentDetections: DenoisedDetectionEntry<T>[],
    options?: DenoisedDetectionOptions<T>
) {
    const now = options?.now || Date.now();

    if (!state.previousDetections)
        state.previousDetections = [];

    const { previousDetections } = state;

    // sort by oldest first.
    previousDetections.sort((a, b) => getDetectionAge(a) - getDetectionAge(b)).reverse();

    const newAndExisting: DenoisedDetectionEntry<T>[] = [];

    const retain = (pd: DenoisedDetectionEntry<T>, cd: DenoisedDetectionEntry<T>) => {
        const index = previousDetections.findIndex(c => c === pd);
        previousDetections.splice(index, 1);
        currentDetections = currentDetections.filter(c => c !== cd);
        cd.firstSeen = pd.firstSeen;
        cd.lastSeen = now;
        cd.durationGone = 0;
        newAndExisting.push(cd);
        options?.retained?.(cd, pd);
    }

    // match previous detections by id
    // currently a no op since ids arent reported by anything
    for (const pd of previousDetections.slice()) {
        if (pd.id) {
            const cd = currentDetections.find(d => d.id === pd.id);
            if (cd) {
                retain(pd, cd);
                continue;
            }
        }
    }

    // match previous detections by class name and bounding box
    const previousClasses = new Set(previousDetections.map(c => c.name));
    for (const name of previousClasses) {
        const previousBoxedDetections = previousDetections.filter(d => !!d.boundingBox && d.name === name);
        const currentBoxedDetections = currentDetections.filter(d => !!d.boundingBox && d.name === name);
        const best = matchBoxes(previousBoxedDetections, currentBoxedDetections);
        if (best) {
            for (const p of best.matched) {
                retain(p.r1, p.r2);
            }
        }
    }

    // match/add current detections with whatever is remaining from the previous list.
    for (const cd of currentDetections) {
        let pd = previousDetections.find(d => d.name === cd.name);
        if (!pd) {
            cd.firstSeen = now;
            cd.lastSeen = now;
            cd.durationGone = 0;
            newAndExisting.push(cd);
            options?.added?.(cd);
        }
        else {
            retain(pd, cd);
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
