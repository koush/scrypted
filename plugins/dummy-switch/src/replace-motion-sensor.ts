import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import { EventListenerRegister, MixinProvider, MotionSensor, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, Settings, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";

export const ReplaceMotionSensorNativeId = 'replaceMotionSensor';

class ReplaceMotionSensorMixin extends SettingsMixinDeviceBase<any> implements Settings {
    storageSettings = new StorageSettings(this, {
        replaceMotionSensor: {
            title: 'Motion Sensor',
            description: 'The motion sensor to attach to this camera or doorbell.',
            value: this.storage.getItem('replaceMotionSensor'),
            deviceFilter: `interfaces.includes('${ScryptedInterface.MotionSensor}') && !interfaces.includes('@scrypted/dummy-switch:ReplaceMotionSensor') && id !== '${this.id}'`,
            type: 'device',
        }
    });

    listener: EventListenerRegister;

    constructor(options: SettingsMixinDeviceOptions<any>) {
        super(options);
        this.motionDetected = false;

        this.register();
    }

    register() {
        this.release();

        const d = this.storageSettings.values.replaceMotionSensor as ScryptedDevice & MotionSensor;
        if (!d)
            return;

        this.listener = d.listen(ScryptedInterface.MotionSensor, () => {
            this.motionDetected = d.motionDetected;
        });
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue) {
        return this.storageSettings.putSetting(key, value);
    }

    async release(): Promise<void> {
        this.listener?.removeListener();
        this.listener = undefined;
    }
}


export class ReplaceMotionSensor extends ScryptedDeviceBase implements MixinProvider {
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (type !== ScryptedDeviceType.Camera && type !== ScryptedDeviceType.Doorbell)
            return;

        return [
            ScryptedInterface.MotionSensor,
            ScryptedInterface.Settings,
            '@scrypted/dummy-switch:ReplaceMotionSensor',
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new ReplaceMotionSensorMixin({
            group: 'Custom Motion Sensor',
            groupKey: 'replaceMotionSensor',
            mixinDevice,
            mixinDeviceInterfaces,
            mixinProviderNativeId: this.nativeId,
            mixinDeviceState,
        });
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}
