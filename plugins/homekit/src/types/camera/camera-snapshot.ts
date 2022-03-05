import sdk, { AudioSensor, Camera, Intercom, MotionSensor, ScryptedDevice, ScryptedInterface, VideoCamera } from "@scrypted/sdk";
import throttle from 'lodash/throttle';
import { HomeKitSession } from '../../common';
import { SnapshotRequest, SnapshotRequestCallback } from "../../hap";

const { mediaManager } = sdk;

export function createSnapshotHandler(device: ScryptedDevice & VideoCamera & Camera & MotionSensor & AudioSensor & Intercom, storage: Storage, homekitSession: HomeKitSession, console: Console) {
    let pendingPicture: Promise<Buffer>;

    const takePicture = async (request: SnapshotRequest) => {
        if (pendingPicture)
            return pendingPicture;

        if (device.interfaces.includes(ScryptedInterface.Camera)) {
            const media = await device.takePicture({
                picture: {
                    width: request.width,
                    height: request.height,
                }
            });
            pendingPicture = mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg');
        }
        else {
            // todo: remove this in favor of snapshot plugin requirement?
            pendingPicture = device.getVideoStream().then(media => mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg'));
        }

        const wrapped = pendingPicture;
        pendingPicture = new Promise((resolve, reject) => {
            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                pendingPicture = undefined;
                const message = `${device.name} is offline or has slow snapshots. This will cause HomeKit to hang. Consider installing the Snapshot Plugin to keep HomeKit responsive. origin:/#/component/plugin/install/@scrypted/snapshot}`;
                console.log(message);
                homekitSession.log.a(message);
                reject(new Error('snapshot timed out'));
            }, 3000);

            wrapped.then(picture => {
                if (!timedOut) {
                    pendingPicture = undefined;
                    clearTimeout(timeout);
                    resolve(picture)
                }
            })
                .catch(e => {
                    if (!timedOut) {
                        pendingPicture = undefined;
                        clearTimeout(timeout);
                        reject(e);
                    }
                })
        });

        return pendingPicture;
    }

    const throttledTakePicture = throttle(takePicture, 9000, {
        leading: true,
        trailing: true,
    });

    function snapshotAll(request: SnapshotRequest) {
        for (const snapshotThrottle of homekitSession.snapshotThrottles.values()) {
            snapshotThrottle(request);
        }
    }

    homekitSession.snapshotThrottles.set(device.id, throttledTakePicture);

    async function handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback) {
        try {
            // non zero reason is for homekit secure video... or something else.
            if (request.reason) {
                console.log('snapshot requested for reason:', request.reason);
                callback(null, await takePicture(request));
                return;
            }

            // console.log(device.name, 'snapshot request', request);

            // an idle Home.app will hit this endpoint every 10 seconds, and slow requests bog up the entire app.
            // avoid slow requests by prefetching every 9 seconds.

            // snapshots are requested em masse, so trigger them rather than wait for home to
            // fetch everything serially.
            // this call is not a bug, to force lodash to take a picture on the trailing edge,
            // throttle must be called twice.
            snapshotAll(request);
            snapshotAll(request);

            callback(null, await throttledTakePicture(request));
        }
        catch (e) {
            console.error('snapshot error', e);
            const message = `${device.name} encountered an error while retrieving a new snapshot. Consider installing the Snapshot Plugin to show the most recent snapshot. origin:/#/component/plugin/install/@scrypted/snapshot}`;
            console.log(message);
            homekitSession.log.a(message);
            callback(e);
        }
    }

    return handleSnapshotRequest;
}
