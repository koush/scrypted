import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import { StorageSettings } from "@scrypted/common/src/settings";
import sdk, { SettingValue } from "@scrypted/sdk";
const { log } = sdk;

export class HomekitMixin<T> extends SettingsMixinDeviceBase<T> {
    storageSettings = new StorageSettings(this, {
        standalone: {
            title: 'Standalone Accessory',
            description: 'Advertise this to HomeKit as a standalone accessory rather than through the Scrypted HomeKit bridge. Enabling this option will remove it from the bridge, and the accessory will then need to be paired to HomeKit.',
            type: 'boolean',
            onPut: () => this.alertReload(),
        }
    });

    alertReload() {
        log.a(`You must reload the HomeKit plugin for the changes to ${this.name} to take effect.`);
    }

    async getMixinSettings() {
        return this.storageSettings.getSettings();
    }

    async putMixinSetting(key: string, value: SettingValue) {
        this.storageSettings.putSetting(key, value);
    }
}
