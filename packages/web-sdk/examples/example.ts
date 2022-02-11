import { connectScryptedClient, OnOff } from '..';

async function example() {
    const sdk = await connectScryptedClient({
        baseUrl: 'https://localhost:10443',
        pluginId: "@scrypted/core",
        username: process.env.SCRYPTED_USERNAME || 'admin',
        password: process.env.SCRYPTED_PASSWORD || 'swordfish',
    });

    const dimmer = sdk.systemManager.getDeviceByName<OnOff>("Office Dimmer");
    dimmer.turnOn();
    await new Promise(resolve => setTimeout(resolve, 5000));
    await dimmer.turnOff(); 
    // allow node to exit
    sdk.disconnect();
}

example();
