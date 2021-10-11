import { Camera, MotionSensor, ScryptedDevice, ScryptedInterface, VideoCamera, AudioSensor, Intercom } from '@scrypted/sdk'
import { SnapshotRequest, SnapshotRequestCallback } from "../../hap";
import fs from "fs";
import sdk from "@scrypted/sdk";
import { HomeKitSession } from '../../common';
import throttle from 'lodash/throttle';

const { mediaManager } = sdk;

const black = fs.readFileSync('black.jpg');

export function createSnapshotHandler(device: ScryptedDevice & VideoCamera & Camera & MotionSensor & AudioSensor & Intercom, homekitSession: HomeKitSession) {
    let lastPictureTime = 0;
    let lastPicture: Buffer;
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
            pendingPicture = device.getVideoStream().then(media => mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg'));
        }

        const wrapped = pendingPicture;
        pendingPicture = new Promise((resolve, reject) => {
            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                pendingPicture = undefined;
                reject(new Error('snapshot timed out'));
            }, 60000);

            wrapped.then(picture => {
                if (!timedOut) {
                    lastPictureTime = Date.now();
                    lastPicture = picture;
                    pendingPicture = undefined;
                    clearTimeout(timeout);
                    resolve(picture)
                }
            })
                .catch(e => {
                    if (!timedOut) {
                        lastPictureTime = Date.now();
                        lastPicture = undefined;
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

            // path to return blank snapshots
            if (localStorage.getItem('blankSnapshots') === 'true') {
                if (lastPicture && lastPictureTime > Date.now() - 15000) {
                    callback(null, lastPicture);
                }
                else {
                    callback(null, black);
                }
                return;
            }

            callback(null, await throttledTakePicture(request));
        }
        catch (e) {
            console.error('snapshot error', e);
            callback(e);
        }
    }

    return handleSnapshotRequest;
}