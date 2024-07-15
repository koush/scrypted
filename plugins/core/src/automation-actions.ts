import { Brightness, Notifier, OnOff, Program, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { StorageSettingsDict } from "@scrypted/sdk/storage-settings";

interface InvokeStorage<T extends string> {
    settings: StorageSettingsDict<T>;
    invoke(storageSettings: StorageSettingsDict<T>): Promise<void>;
}

export const automationActions = new Map<ScryptedInterface, InvokeStorage<any>>();

function addAction<T extends string>(
    iface: ScryptedInterface,
    settings: StorageSettingsDict<T>,
    invoke: (device: ScryptedDevice, storageSettings: StorageSettingsDict<T>) => Promise<void>) {
    automationActions.set(iface, {
        settings,
        invoke: async (storageSettings) => {
            const device = this as ScryptedDevice;
            return invoke(device, storageSettings);
        }
    });
}

addAction(ScryptedInterface.OnOff, {
        on: {
            title: 'Turn On/Off',
            type: 'boolean',
        }
    }, async function invoke(device: ScryptedDevice & OnOff, storageSettings) {
        return storageSettings.on ? device.turnOn() : device.turnOff();
    });

addAction(ScryptedInterface.Brightness, {
        brightness: {
            title: 'Brightness',
            type: 'number',
        }
    }, async function invoke(device: ScryptedDevice & Brightness, storageSettings) {
        return device.setBrightness(storageSettings.brightness as number);
    });

addAction(ScryptedInterface.Program, {},
    async function invoke(device: ScryptedDevice & Program, storageSettings) {
        return device.run();
    });

addAction(ScryptedInterface.Notifier, {
    title: {
        title: 'Title',
        type: 'string',
    },
    body: {
        title: 'Body',
        type: 'string',
    },
    image: {
        title: 'Image',
        type: 'interface',
        deviceFilter: `deviceInterface === '${ScryptedInterface.VideoCamera}' || deviceInterface === '${ScryptedInterface.Camera}'`,
    },
}, async function invoke(device: ScryptedDevice & Notifier, storageSettings) {
    return device.sendNotification(storageSettings.title as string, {
        body: storageSettings.body as string,
    });
});