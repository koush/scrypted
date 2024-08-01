import { Brightness, Camera, Lock, LockState, Notifier, OnOff, Program, ScryptedDevice, ScryptedInterface, StartStop, VideoCamera } from "@scrypted/sdk";
import { StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import sdk from '@scrypted/sdk';

interface InvokeStorage<T extends string> {
    settings: StorageSettingsDict<T>;
    invoke(device: ScryptedDevice, storageSettings: { [key in T]: any }): Promise<void>;
}

export const automationActions = new Map<ScryptedInterface, InvokeStorage<any>>();

function addAction<T extends string>(
    iface: ScryptedInterface,
    settings: StorageSettingsDict<T>,
    invoke: (device: ScryptedDevice, storageSettings: { [key in T]: any }) => Promise<void>) {
    automationActions.set(iface, {
        settings,
        invoke
    });
}

addAction(ScryptedInterface.OnOff, {
    on: {
        title: 'Turn On/Off',
        description: 'Enable to turn on the device. Disable to turn off the device.',
        type: 'boolean',
        immediate: true,
    }
}, async function invoke(device: ScryptedDevice & OnOff, storageSettings) {
    return storageSettings.on ? device.turnOn() : device.turnOff();
});

addAction(ScryptedInterface.StartStop, {
    running: {
        title: 'Start/Stop',
        description: 'Enable to start the device. Disable to stop the device.',
        type: 'boolean',
        immediate: true,
    }
}, async function invoke(device: ScryptedDevice & StartStop, storageSettings) {
    device.running
    return storageSettings.running ? device.start() : device.stop();
});

addAction(ScryptedInterface.Lock, {
    lockState: {
        title: 'Lock/Unlock',
        choices: [LockState.Locked, LockState.Unlocked],
        defaultValue: LockState.Locked,
        immediate: true,
    }
}, async function invoke(device: ScryptedDevice & Lock, storageSettings) {
    return storageSettings.lockState === LockState.Unlocked ? device.unlock() : device.lock();
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
    notificationTitle: {
        title: 'Title',
        type: 'string',
    },
    notificationBody: {
        title: 'Body',
        type: 'string',
    },
    notificationMediaUrl: {
        title: 'Image',
        type: 'interface',
        deviceFilter: `deviceInterface === '${ScryptedInterface.VideoCamera}' || deviceInterface === '${ScryptedInterface.Camera}'`,
    },
}, async function invoke(device: ScryptedDevice & Notifier, storageSettings) {
    let { notificationMediaUrl } = storageSettings;
    if (notificationMediaUrl && !notificationMediaUrl?.includes('://')) {
        const [id,iface] = notificationMediaUrl.split('#');
        if (iface === ScryptedInterface.Camera) {
            const mediaDevice = sdk.systemManager.getDeviceById<Camera>(id);
            notificationMediaUrl = await mediaDevice.takePicture({
                reason: 'event',
            });
        }
        else {
            const mediaDevice = sdk.systemManager.getDeviceById<VideoCamera>(id);
            notificationMediaUrl = mediaDevice.getVideoStream();
        }

    }

    return device.sendNotification(storageSettings.notificationTitle as string, {
        body: storageSettings.notificationBody as string,
    }, notificationMediaUrl);
});