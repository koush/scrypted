import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import { BinarySensor, EventListenerRegister, MixinProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, Settings, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";

export const ReplaceBinarySensorNativeId = 'replaceBinarySensor';

class ReplaceBinarySensorMixin extends SettingsMixinDeviceBase<any> implements Settings {
    storageSettings = new StorageSettings(this, {
        replaceBinarySensor: {
            title: 'Doorbell Button',
            description: 'The binary sensor to attach to this camera.',
            value: this.storage.getItem('replaceBinarySensor'),
            deviceFilter: `interfaces.includes('${ScryptedInterface.BinarySensor}') && !interfaces.includes('@scrypted/dummy-switch:ReplaceBinarySensor') && id !== '${this.id}'`,
            type: 'device',
        }
    });

    listener: EventListenerRegister;

    constructor(options: SettingsMixinDeviceOptions<any>) {
        super(options);
        this.binaryState = false;

        this.register();
    }

    register() {
        this.release();

        const d = this.storageSettings.values.replaceBinarySensor as ScryptedDevice & BinarySensor;
        if (!d)
            return;

        this.listener = d.listen(ScryptedInterface.BinarySensor, () => {
            this.binaryState = d.binaryState;
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


export class ReplaceBinarySensor extends ScryptedDeviceBase implements MixinProvider {
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (type !== ScryptedDeviceType.Camera && type !== ScryptedDeviceType.Doorbell)
            return;

        return [
            ScryptedInterface.BinarySensor,
            ScryptedInterface.Settings,
            '@scrypted/dummy-switch:ReplaceBinarySensor',
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new ReplaceBinarySensorMixin({
            group: 'Custom Doorbell Button',
            groupKey: 'replaceBinarySensor',
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
