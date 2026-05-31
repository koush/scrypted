import { Camera, VideoCamera, VideoFrameGenerator } from '@scrypted/types';
import { connectScryptedClient } from '../dist/packages/client/src';

async function example() {
    const sdk = await connectScryptedClient({
        baseUrl: 'https://localhost:10443',
        pluginId: "@scrypted/core",
        username: process.env.SCRYPTED_USERNAME || 'admin',
        password: process.env.SCRYPTED_PASSWORD || 'swordfish',
    });
    console.log('server version', sdk.serverVersion);

    const office = sdk.systemManager.getDeviceByName<VideoCamera & Camera>("Office");
    const libav = sdk.systemManager.getDeviceByName<VideoFrameGenerator>("Libav");
    const mo = await office.getVideoStream();

    const generator = await libav.generateVideoFrames(mo);
    const remote = await sdk.connectRPCObject!(generator);

    for await (const frame of remote) {
        console.log(frame);
    }
}

example();
