import { sleep } from "@scrypted/common/src/sleep";
import sdk, { AudioSensor, Camera, Intercom, Logger, MotionSensor, ScryptedDevice, ScryptedInterface, VideoCamera } from "@scrypted/sdk";
import throttle from "lodash/throttle";
import { ResourceRequestReason, SnapshotRequest, SnapshotRequestCallback } from "../../hap";
import type { HomeKitPlugin } from "../../main";

const { systemManager, mediaManager } = sdk;

function recommendSnapshotPlugin(console: Console, log: Logger, message: string) {
    if (systemManager.getDeviceByName('@scrypted/snapshot'))
        return;
    console.log(message);
    log.a(message);
}

export function createSnapshotHandler(device: ScryptedDevice & VideoCamera & Camera & MotionSensor & AudioSensor & Intercom, storage: Storage, homekitPlugin: HomeKitPlugin, console: Console) {
    const takePicture = async (request: SnapshotRequest) => {
        if (!device.interfaces.includes(ScryptedInterface.Camera))
            throw new Error('Camera does not provide native snapshots. Please install the Snapshot Plugin.');

        const media = await device.takePicture({
            reason: request.reason === ResourceRequestReason.EVENT ? 'event' : 'periodic',
            picture: {
                width: request.width,
                height: request.height,
            },
        })
        return await mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg');
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

            callback(null, await takePicture(request));
        }
        catch (e) {
            console.error('snapshot error', e);
            recommendSnapshotPlugin(console, homekitPlugin.log, `${device.name} encountered an error while retrieving a new snapshot. Consider installing the Snapshot Plugin to show the most recent snapshot. origin:/#/component/plugin/install/@scrypted/snapshot}`);
            callback(e);
        }
    }

    return handleSnapshotRequest;
}
