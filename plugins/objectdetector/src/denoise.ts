export class DenoisedDetectionEntry<T> {
    id: string;
    name: string;
    detection: T;
    lastSeen: number;
}

export interface DenoisedDetectionOptions<T> {
    added?: (detection: DenoisedDetectionEntry<T>) => void;
    removed?: (detection: DenoisedDetectionEntry<T>) => void;
    timeout?: number;
}

export function denoiseDetections<T>(previousDetections: DenoisedDetectionEntry<T>[],
    currentDetections: DenoisedDetectionEntry<T>[],
    options?: DenoisedDetectionOptions<T>
) {
    const now = Date.now();
    const newAndExisting: DenoisedDetectionEntry<T>[] = [];
    for (const cd of currentDetections) {
        let index = -1;
        if (cd.id)
            index = previousDetections.findIndex(d => d.id === cd.id);
        if (index === -1)
            index = previousDetections.findIndex(d => d.name === cd.name);
        if (index === -1) {
            newAndExisting.push(cd);
            options?.added?.(cd);
        }
        else {
            const [found] = previousDetections.splice(index, 1);
            found.lastSeen = now;
            newAndExisting.push(cd);
        }
    }

    const purgeTime = options?.timeout || 10000;
    // anything remaining in previousDetections at this point has possibly left the scene.
    for (const cd of previousDetections.slice()) {
        if (now - cd.lastSeen < purgeTime)
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
}
