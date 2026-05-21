import sdk, { AudioSensor, Camera, Intercom, Logger, MotionSensor, ScryptedDevice, ScryptedInterface, VideoCamera } from "@scrypted/sdk";
import { ResourceRequestReason, SnapshotRequest, SnapshotRequestCallback } from "../../hap";
import type { HomeKitPlugin } from "../../main";

const { systemManager, mediaManager } = sdk;

// hap-nodejs warns at 8s and gives up at 25s. Stay well under the warning threshold
// so a hung camera never stalls the HomeKit plugin's event loop.
const SNAPSHOT_TIMEOUT_MS = 6000;

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

    // Race takePicture against a hard timeout so a hung camera can never stall
    // the HomeKit plugin's event loop long enough to trigger hap-nodejs's slow/
    // no-response warnings, which have been observed to crash the whole plugin.
    function takePictureWithTimeout(request: SnapshotRequest): Promise<Buffer> {
        return Promise.race([
            takePicture(request),
            new Promise<never>((_, reject) => {
                const t = setTimeout(
                    () => reject(new Error(`${device.name} snapshot timed out after ${SNAPSHOT_TIMEOUT_MS}ms`)),
                    SNAPSHOT_TIMEOUT_MS,
                );
                // Don't let this timer prevent Node from exiting cleanly.
                t.unref();
            }),
        ]);
    }

    async function handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback) {
        try {
            // non zero reason is for homekit secure video... or something else.
            if (request.reason) {
                console.log('snapshot requested for reason:', request.reason);
                callback(null, await takePictureWithTimeout(request));
                return;
            }

            callback(null, await takePictureWithTimeout(request));
        }
        catch (e) {
            console.error('snapshot error', e);
            recommendSnapshotPlugin(console, homekitPlugin.log, `${device.name} encountered an error while retrieving a new snapshot. Consider installing the Snapshot Plugin to show the most recent snapshot. origin:/#/component/plugin/install/@scrypted/snapshot}`);
            callback(e);
        }
    }

    return handleSnapshotRequest;
}
