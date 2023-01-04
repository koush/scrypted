import { ObjectDetector, ObjectsDetected, ScryptedInterface } from '@scrypted/types';
import { connectScryptedClient } from '../dist/packages/client/src';

import https from 'https';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
})

async function example() {
    const sdk = await connectScryptedClient({
        baseUrl: 'https://localhost:10443',
        pluginId: "@scrypted/core",
        username: process.env.SCRYPTED_USERNAME || 'admin',
        password: process.env.SCRYPTED_PASSWORD || 'swordfish',
        axiosConfig: {
            httpsAgent,
        }
    });
    console.log('server version', sdk.serverVersion);

    const backyard = sdk.systemManager.getDeviceByName<ObjectDetector>("Hikvision Test");
    if (!backyard)
        throw new Error('Device not found');

    backyard.listen(ScryptedInterface.ObjectDetector, (source, details, data) => {
        const results = data as ObjectsDetected;
        console.log(results);
    })
}

example();
