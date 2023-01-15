import { DeviceProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";

const { log, deviceManager } = sdk;

export class AddProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    constructor(nativeId: string, public deviceName: string, public defaultType: ScryptedDeviceType, public defaultInterfaces: ScryptedInterface[], public pluginClass: (nativeId: string) => ScryptedDeviceBase) {
        super(nativeId);
    }

    async getSettings(): Promise<Setting[]> {
        return [{
            title: 'Add New ' + this.deviceName,
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
                interfaces: this.defaultInterfaces,
                type: this.defaultType,
            });

            var text = `${name} ready. Check the notification area to complete setup.`;
            log.a(text);
            log.clearAlert(text);
        }
    }

    async discoverDevices(duration: number): Promise<void> {
    }
    
    async getDevice(nativeId: string) {
        return this.pluginClass(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }
}

export class InstancedProvider extends AddProvider {
    constructor(nativeId: string, hubName: string, public pluginClass: (nativeId: string) => ScryptedDeviceBase & DeviceProvider) {
        super(nativeId, hubName, ScryptedDeviceType.DeviceProvider, [ScryptedInterface.DeviceProvider, ScryptedInterface.Settings], pluginClass);
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
    if (!localStorage.getItem('instance-mode')) {
        return pluginClass(undefined);
    }

    return new InstancedProvider(undefined, name, pluginClass);
}
