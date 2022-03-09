import sdk, {ScryptedPlugin} from '@scrypted/sdk'; // SCRYPTED_FILTER_EXAMPLE_LINE
const { systemManager } = sdk; // SCRYPTED_FILTER_EXAMPLE_LINE

declare const snapshot: { [pluginId: string]: string }; // SCRYPTED_FILTER_EXAMPLE_LINE

const plugins = await systemManager.getComponent('plugins');
const forceReinstall = false;

delete snapshot['@scrypted/core'];

for (const pluginId of Object.keys(snapshot)) {
    try {
        const id = await plugins.getIdForPluginId(pluginId);
        const pluginVersion = `${pluginId}@${snapshot[pluginId]}`;
        if (id) {
            const plugin = systemManager.getDeviceById<ScryptedPlugin>(id);
            if (plugin?.info?.version === snapshot[pluginId]) {
                console.log(`${pluginVersion} matches. Skipping installation.`);
                continue;
            }
            console.log('\x1b[33m%s\x1b[0m', `${pluginVersion} version mismatch. Installing...`);
        }
        else {
            console.log('\x1b[33m%s\x1b[0m', `${pluginVersion} not installed. Installing..`);
        }

        await plugins.installNpm(pluginId, snapshot[pluginId]);
        console.log('\x1b[32m%s\x1b[0m', `${pluginVersion} installed.`);

    }
    catch (e) {
        console.error('\x1b[31m%s\x1b[0m', 'Error installing plugin!', pluginId, e.message);
    }
}
