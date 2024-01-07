import { ObjectsDetected, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk";
import { OnvifCameraAPI, OnvifEvent } from "./onvif-api";
import { Destroyable } from "../../rtsp/src/rtsp";

export async function listenEvents(thisDevice: ScryptedDeviceBase, client: OnvifCameraAPI, motionTimeoutMs = 30000) {
    let motionTimeout: NodeJS.Timeout;
    let binaryTimeout: NodeJS.Timeout;

    const triggerMotion = () => {
        thisDevice.motionDetected = true;
        clearTimeout(motionTimeout);
        motionTimeout = setTimeout(() => thisDevice.motionDetected = false, motionTimeoutMs);
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
            // furthermore, cameras are not guaranteed to send motion stop events, which makes.
            // for the sake of providing normalized motion durations through scrypted, debounce the motion.
            triggerMotion();
            // thisDevice.motionDetected = true;
        }
        else if (event === OnvifEvent.MotionStop) {
            // reset the trigger to debounce per above.
            if (thisDevice.motionDetected)
                triggerMotion();

            // thisDevice.motionDetected = false;
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
