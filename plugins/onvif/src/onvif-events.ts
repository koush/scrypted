import { ObjectsDetected, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk";
import { OnvifCameraAPI, OnvifEvent } from "./onvif-api";
import { Destroyable } from "../../rtsp/src/rtsp";

export async function listenEvents(thisDevice: ScryptedDeviceBase, client: OnvifCameraAPI) {
    let motionTimeout: NodeJS.Timeout;
    let binaryTimeout: NodeJS.Timeout;

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
            thisDevice.motionDetected = true;
            clearTimeout(motionTimeout);
            motionTimeout = setTimeout(() => thisDevice.motionDetected = false, 30000);
            return;
        }
        if (event === OnvifEvent.BinaryRingEvent) {
            thisDevice.binaryState = true;
            clearTimeout(binaryTimeout);
            binaryTimeout = setTimeout(() => thisDevice.binaryState = false, 30000);
            return;
        }

        if (event === OnvifEvent.MotionStart)
            thisDevice.motionDetected = true;
        else if (event === OnvifEvent.MotionStop)
            thisDevice.motionDetected = false;
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

    const ret: Destroyable = {
        destroy() {
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
    };

    return ret;
}
