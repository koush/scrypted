import { Tensor3D } from "@tensorflow/tfjs-core";

export interface DetectionInput {
    buffer?: Buffer;
    input: Tensor3D;
}

export class DenoisedDetectionEntry<T> {
    name: string;
    detection: T;
    timeout?: NodeJS.Timeout;
}

export interface DenoisedDetectionOptions<T> {
    added?: (detection: DenoisedDetectionEntry<T>) => void
    removed?: (detection: DenoisedDetectionEntry<T>) => void
}

export function denoiseDetections<T>(previousDetections: DenoisedDetectionEntry<T>[],
    currentDetections: DenoisedDetectionEntry<T>[],
    options?: DenoisedDetectionOptions<T>
) {
    const newAndExisting: DenoisedDetectionEntry<T>[] = [];
    for (const cd of currentDetections) {
        const index = previousDetections.findIndex(d => d.name === cd.name);
        if (index === -1) {
            newAndExisting.push(cd);
            options?.added?.(cd);
        }
        else {
            const [found] = previousDetections.splice(index, 1);
            if (found.timeout) {
                clearTimeout(found.timeout);
                found.timeout = undefined;
            }
            newAndExisting.push(found);
        }
    }

    // anything remaining in previousDetections at this point has possibly left the scene.
    for (const cd of previousDetections) {
        if (!cd.timeout) {
            cd.timeout = setTimeout(() => {
                const index = previousDetections.findIndex(check => check === cd);
                if (index !== -1)
                    previousDetections.splice(index, 1);
                options?.removed?.(cd);
            }, 10000);
        }
    }

    // add all the detections that are pending removal
    newAndExisting.push(...previousDetections);

    // clear it out
    previousDetections.splice(0, previousDetections.length);

    previousDetections.push(...newAndExisting);
}
