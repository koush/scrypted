import { ObjectDetector, ObjectsDetected, ScryptedInterface } from '@scrypted/types';
import { connectScryptedClient } from '../dist/packages/client/src';

async function example() {
    const sdk = await connectScryptedClient({
        baseUrl: 'https://localhost:10443',
        pluginId: "@scrypted/core",
        username: process.env.SCRYPTED_USERNAME || 'admin',
        password: process.env.SCRYPTED_PASSWORD || 'swordfish',
    });
    console.log('server version', sdk.serverVersion);

    const backyard = sdk.systemManager.getDeviceByName<ObjectDetector>("IP CAMERA");
    if (!backyard)
        throw new Error('Device not found');

    backyard.listen(ScryptedInterface.ObjectDetector, async (source, details, data) => {
        const results = data as ObjectsDetected;
        console.log('detection results', results);
        // detections that are flagged for retention will have a detectionId.
        // tf etc won't retain automatically, and this requires a wrapping detector like Scrypted NVR Object Detection
        // to decide which frames to keep. Otherwise saving all images would be extremely poor performance.
        if (!results.detectionId)
            return;

        const media = await backyard.getDetectionInput(results.detectionId);
        const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg');
        // do something with the buffer like save to disk or send to a service.
    });
}

example();
