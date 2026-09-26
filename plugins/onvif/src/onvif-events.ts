import { ObjectsDetected, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface, Setting } from "@scrypted/sdk";
import { OnvifCameraAPI, OnvifEvent } from "./onvif-api";
import { Destroyable } from "../../rtsp/src/rtsp";

const MOTION_DEBOUNCE_MS = 30000;
// once a camera has proven it sends real motion stop events, trust them, and only
// use this as a failsafe in case a stop is ever dropped.
const MOTION_FAILSAFE_MS = 8 * 60 * 60 * 1000;

const LAST_MOTION_START = 'lastMotionStart';
const LAST_MOTION_STOP = 'lastMotionStop';
// last motion stop that arrived more than the debounce period after its start.
// that is proof the camera reports the true end of motion, which the debounce would have cut short.
const LAST_PROVEN_MOTION_STOP = 'lastProvenMotionStop';

function getStorageTime(storage: Storage, key: string) {
    return parseInt(storage.getItem(key)) || 0;
}

function isCameraReportedMotion(storage: Storage) {
    return Date.now() - getStorageTime(storage, LAST_PROVEN_MOTION_STOP) < MOTION_FAILSAFE_MS;
}

function formatStorageTime(storage: Storage, key: string) {
    const time = getStorageTime(storage, key);
    return time ? new Date(time).toLocaleString() : 'Never';
}

export function getMotionMonitorSettings(storage: Storage): Setting[] {
    return [
        {
            subgroup: 'Advanced',
            key: 'motionStartSeen',
            title: 'Last MotionStart seen from camera',
            description: 'The most recent ONVIF motion start event received from the camera. For monitoring only.',
            type: 'string',
            readonly: true,
            value: formatStorageTime(storage, LAST_MOTION_START),
        },
        {
            subgroup: 'Advanced',
            key: 'motionStopSeen',
            title: 'Last MotionStop seen from camera',
            description: 'The most recent ONVIF motion stop event received from the camera. For monitoring only.',
            type: 'string',
            readonly: true,
            value: formatStorageTime(storage, LAST_MOTION_STOP),
        },
        {
            subgroup: 'Advanced',
            key: 'motionMode',
            title: 'Motion Mode',
            description: 'Cameras that do not report motion stop events are debounced. Cameras that are seen reporting them are trusted automatically.',
            type: 'string',
            readonly: true,
            value: isCameraReportedMotion(storage)
                ? 'Camera reported (stop events trusted, 8 hour failsafe)'
                : 'Debounced (30 seconds)',
        },
    ];
}

export async function listenEvents(thisDevice: ScryptedDeviceBase, client: OnvifCameraAPI, motionTimeoutMs = MOTION_DEBOUNCE_MS) {
    let motionTimeout: NodeJS.Timeout;
    let binaryTimeout: NodeJS.Timeout;
    // when the current motion began (first start since the last stop).
    let motionStartedAt: number;

    const triggerMotion = () => {
        thisDevice.motionDetected = true;
        clearTimeout(motionTimeout);
        motionTimeout = setTimeout(() => thisDevice.motionDetected = false, motionTimeoutMs);
    };

    const triggerCameraReportedMotion = () => {
        thisDevice.motionDetected = true;
        clearTimeout(motionTimeout);
        motionTimeout = setTimeout(() => {
            thisDevice.console.warn('motion start received without a motion stop, reverting to debounced motion.');
            thisDevice.storage.removeItem(LAST_PROVEN_MOTION_STOP);
            thisDevice.motionDetected = false;
        }, MOTION_FAILSAFE_MS);
    };

    const onMotionStart = () => {
        const now = Date.now();
        thisDevice.storage.setItem(LAST_MOTION_START, now.toString());
        motionStartedAt ??= now;

        if (isCameraReportedMotion(thisDevice.storage))
            triggerCameraReportedMotion();
        else
            triggerMotion();
    };

    const onMotionStop = () => {
        const now = Date.now();
        thisDevice.storage.setItem(LAST_MOTION_STOP, now.toString());

        // this must be evaluated before checking motionDetected, as the debounce may have
        // already expired if the motion was long. that is exactly the case that proves the
        // camera sends usable motion stop events.
        const proven = motionStartedAt !== undefined && now - motionStartedAt > motionTimeoutMs;
        motionStartedAt = undefined;
        if (proven) {
            if (!isCameraReportedMotion(thisDevice.storage))
                thisDevice.console.log('camera reported a motion stop after a long motion, trusting camera motion events.');
            thisDevice.storage.setItem(LAST_PROVEN_MOTION_STOP, now.toString());
        }

        if (isCameraReportedMotion(thisDevice.storage)) {
            clearTimeout(motionTimeout);
            thisDevice.motionDetected = false;
        }
        else if (thisDevice.motionDetected) {
            // reset the trigger to debounce.
            triggerMotion();
        }
    };

    try {
        await client.supportsEvents();
    }
    catch (e) {
    }
    await client.createSubscription();

    thisDevice.console.log('listening events');
    const events = client.listenEvents();
    events.on('event', (event, className) => {
        if (event === OnvifEvent.MotionBuggy) {
            // some onvif cameras have motion with no associated motion end event.
            triggerMotion();
            return;
        }
        if (event === OnvifEvent.BinaryRingEvent) {
            thisDevice.binaryState = true;
            clearTimeout(binaryTimeout);
            binaryTimeout = setTimeout(() => thisDevice.binaryState = false, motionTimeoutMs);
            return;
        }

        if (event === OnvifEvent.MotionStart) {
            // some onvif cameras (like the reolink doorbell) have very short duration motion
            // events.
            // furthermore, cameras are not guaranteed to send motion stop events.
            // for the sake of providing normalized motion durations through scrypted, debounce the motion,
            // until a camera has proven that its motion stop events can be trusted.
            onMotionStart();
        }
        else if (event === OnvifEvent.MotionStop) {
            onMotionStop();
        }
        else if (event === OnvifEvent.AudioStart)
            thisDevice.audioDetected = true;
        else if (event === OnvifEvent.AudioStop)
            thisDevice.audioDetected = false;
        else if (event === OnvifEvent.BinaryStart)
            thisDevice.binaryState = true;
        else if (event === OnvifEvent.BinaryStop)
            thisDevice.binaryState = false;
        else if (event === OnvifEvent.Detection) {
            const d: ObjectsDetected = {
                timestamp: Date.now(),
                detections: [
                    {
                        score: undefined,
                        className,
                    }
                ]
            }
            thisDevice.onDeviceEvent(ScryptedInterface.ObjectDetector, d);
        }
    });

    const ret = {
        destroy() {
            clearTimeout(binaryTimeout);
            clearTimeout(motionTimeout);
            try {
                client.unsubscribe();
            }
            catch (e) {
                console.warn('Error unsubscribing', e);
            }
        },
        on(eventName: string | symbol, listener: (...args: any[]) => void) {
            return events.on(eventName, listener);
        },
        emit(eventName: string | symbol, ...args: any[]) {
            return events.emit(eventName, ...args);
        },
        triggerMotion,
    };

    return ret;
}
