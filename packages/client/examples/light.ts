import { connectScryptedClient } from '../dist/packages/client/src';
import { OnOff } from '@scrypted/types';

async function example() {
    const sdk = await connectScryptedClient({
        baseUrl: 'https://localhost:10443',
        pluginId: "@scrypted/core",
        username: process.env.SCRYPTED_USERNAME || 'admin',
        password: process.env.SCRYPTED_PASSWORD || 'swordfish',
    });
    console.log('server version', sdk.serverVersion);

    const dimmer = sdk.systemManager.getDeviceByName<OnOff>("Office Dimmer");
    if (!dimmer)
        throw new Error('Device not found');
    dimmer.turnOn();
    await new Promise(resolve => setTimeout(resolve, 5000));
    await dimmer.turnOff();
    // allow node to exit
    sdk.disconnect();
}

example();
