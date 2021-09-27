import { DeviceProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";

const { log, deviceManager } = sdk;

export class InstancedProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    constructor(public hubName: string, public pluginClass: (nativeId: string) => ScryptedDeviceBase & DeviceProvider) {
        super();
    }
    async getSettings(): Promise<Setting[]> {
        return [{
            title: 'Add New ' + this.hubName,
            key: 'add',
        }];
    }
    async putSetting(key: string, value: string | number | boolean): Promise<void> {
        if (key === 'add') {
            const nativeId = Math.random().toString();
            const name = value.toString();
    
            deviceManager.onDeviceDiscovered({
                nativeId,
                name,
                interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.Settings],
                type: ScryptedDeviceType.DeviceProvider,
            });

            var text = `${name} ready. Check the notification area to complete setup.`;
            log.a(text);
            log.clearAlert(text);
        }
    }

    async discoverDevices(duration: number): Promise<void> {
    }
    getDevice(nativeId: string) {
        return this.pluginClass(nativeId);
    }
}

export async function enableInstanceableProviderMode() {
    const providerNativeId = Math.random().toString();
    const currentProvider = new ScryptedDeviceBase();
    await deviceManager.onDeviceDiscovered({
        name: "Default Controller (Migrated)",
        nativeId: providerNativeId,
        interfaces: currentProvider.providedInterfaces,
        type: currentProvider.providedType,
    })
    for (const nativeId of deviceManager.getNativeIds()) {
        if (!nativeId || nativeId === providerNativeId)
            continue;
        const device = new ScryptedDeviceBase(nativeId);
        await deviceManager.onDeviceDiscovered({
            name: device.providedName,
            nativeId: device.nativeId,
            providerNativeId,
            interfaces: device.providedInterfaces,
            type: device.providedType,
        })
    }
    const newProvider = new ScryptedDeviceBase(providerNativeId);
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        newProvider.storage.setItem(key, value);
    }
    localStorage.clear();

    localStorage.setItem('instance-mode', 'true')

    log.a('Reload the plugin to finish applying this change.');

    setTimeout(() => process.exit(), 1000);
}

export function isInstanceableProviderModeEnabled() {
    return !!localStorage.getItem('instance-mode');
}

export function createInstanceableProviderPlugin(name: string, pluginClass: (nativeId: string) => ScryptedDeviceBase & DeviceProvider) {
    if (!localStorage.getItem('instance-mode'))  {
        return pluginClass(undefined);
    }

    return new InstancedProvider(name, pluginClass);
}
