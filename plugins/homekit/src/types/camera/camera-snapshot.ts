import { sleep } from "@scrypted/common/src/sleep";
import sdk, { AudioSensor, Camera, Intercom, Logger, MotionSensor, ScryptedDevice, ScryptedInterface, VideoCamera } from "@scrypted/sdk";
import throttle from "lodash/throttle";
import { SnapshotRequest, SnapshotRequestCallback } from "../../hap";
import type { HomeKitPlugin } from "../../main";

const { systemManager, mediaManager } = sdk;

function recommendSnapshotPlugin(console: Console, log: Logger, message: string) {
    if (systemManager.getDeviceByName('@scrypted/snapshot'))
        return;
    console.log(message);
    log.a(message);
}

export function createSnapshotHandler(device: ScryptedDevice & VideoCamera & Camera & MotionSensor & AudioSensor & Intercom, storage: Storage, homekitPlugin: HomeKitPlugin, console: Console) {
    let pendingPicture: Promise<Buffer>;

    const takePicture = (request: SnapshotRequest) => {
        if (pendingPicture)
            return pendingPicture;

        if (device.interfaces.includes(ScryptedInterface.Camera)) {
            pendingPicture = device.takePicture({
                picture: {
                    width: request.width,
                    height: request.height,
                }
            })
                .then(media => mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg'));
        }
        else {
            pendingPicture = Promise.reject(new Error('Camera does not provide native snapshots. Please install the Snapshot Plugin.'));
        }

        pendingPicture
            .finally(() => {
                pendingPicture = undefined;
            })

        return pendingPicture;
    }

    const throttledTakePicture = throttle(takePicture, 9000, {
        leading: true,
        trailing: true,
    });
    function snapshotAll(request: SnapshotRequest) {
        for (const snapshotThrottle of homekitPlugin.snapshotThrottles.values()) {
            snapshotThrottle(request);
        }
    }

    homekitPlugin.snapshotThrottles.set(device.id, takePicture);

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

            // no longer necessary in accessory mode?
            snapshotAll(request);
            snapshotAll(request);

            callback(null, await throttledTakePicture(request));
        }
        catch (e) {
            console.error('snapshot error', e);
            recommendSnapshotPlugin(console, homekitPlugin.log, `${device.name} encountered an error while retrieving a new snapshot. Consider installing the Snapshot Plugin to show the most recent snapshot. origin:/#/component/plugin/install/@scrypted/snapshot}`);
            callback(e);
        }
    }

    return handleSnapshotRequest;
}
