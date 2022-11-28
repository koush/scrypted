import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Settings, SystemManager } from "@scrypted/types";
import { findPluginDevice } from "../helpers";

export function createSystemSettingsDevice(systemManager: SystemManager): ScryptedDevice & Settings {
    const core = systemManager.getDeviceByName<Settings>('@scrypted/core');
    const transcode = findPluginDevice<Settings>(systemManager, '@scrypted/prebuffer-mixin', 'transcode');

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
        listen(event, callback) {
            const cl = core.listen(event, callback);
            const tl = transcode?.listen(event, callback);
            return {
                removeListener() {
                    cl.removeListener();
                    tl?.removeListener();
                },
            }
        },
        async getSettings() {
            return [
                ...(await core.getSettings()).map(s => ({
                    ...s,
                    key: 'core:' + s.key,
                    group: 'Network Settings',
                })),
                ...(await transcode?.getSettings() || []).map(s => ({
                    ...s,
                    key: 'transcode:' + s.key,
                    group: 'Transcoding',
                })),
            ];
        },
        async putSetting(key, value) {
            if (key.startsWith('core:')) {
                await core.putSetting(key.substring(5), value);
            }
            else if (key.startsWith('transcode:')) {
                await transcode.putSetting(key.substring(10), value);
            }
        },
    }
}