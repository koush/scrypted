import { Camera } from '@scrypted/types';
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

    const office = sdk.systemManager.getDeviceByName<Camera>("Office");
    const mo = await office.takePicture();

    console.log("standard rpc object", mo);

    const remote = await sdk.connectRPCObject(mo);
    console.log("connectRPCObject object", remote);
}

example();
