import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Settings, SystemManager } from "@scrypted/types";
import { findPluginDevice } from "../helpers";

export function createSystemSettingsDevice(systemManager: SystemManager): ScryptedDevice & Settings {
    const systemSettings = Object.keys(systemManager.getSystemState())
        .map(id => systemManager.getDeviceById<Settings>(id))
        .filter(d => d.interfaces?.includes("SystemSettings"));

    return {
        name: 'Settings',
        type: ScryptedDeviceType.Builtin,
        interfaces: [
            ScryptedInterface.Settings,
        ],
        async setName(name) {

        },
        async setRoom() {

        },
        async setType() {

        },
        async probe() {
            return true;
        },
        async setMixins() {

        },
        listen(event, callback) {
            let listeners = systemSettings.map(d => d.listen(event, callback));
            return {
                removeListener() {
                    for (const l of listeners) {
                        l.removeListener();
                    }
                    listeners = [];
                },
            }
        },
        async getSettings() {
            const results = systemSettings.map(async d => {
                const settings = await d.getSettings();
                for (const setting of settings) {
                    if (d.pluginId === '@scrypted/core')
                        setting.group = 'General';
                    else
                        setting.group = d.name;
                    setting.key = d.id + ':' + setting.key;
                }
                return settings;
            });
            return (await Promise.all(results)).flat();
        },
        async putSetting(key, value) {
            const [id, realKey] = key.split(':');
            const device = systemSettings.find(d => d.id === id);
            return device?.putSetting(realKey, value);
        },
    }
}
