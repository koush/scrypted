import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import sdk, { ScryptedInterface, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { createHAPUsernameStorageSettingsDict } from "./hap-utils";

export const HOMEKIT_MIXIN = 'mixin:@scrypted/homekit';

export class HomekitMixin<T> extends SettingsMixinDeviceBase<T> {
    storageSettings = new StorageSettings(this, {
        ...createHAPUsernameStorageSettingsDict(this, undefined, 'Pairing'),
        standalone: {
            subgroup: 'Pairing',
            title: 'Standalone Accessory Mode',
            description: 'Advertise this to HomeKit as a standalone accessory rather than through the Scrypted HomeKit bridge. Enabling this option will remove it from the bridge. The accessory will then need to be re-paired to HomeKit. The pairing code will be available after the HomeKit plugin has been reloaded.'
                + (this.interfaces.includes(ScryptedInterface.VideoCamera)
                    ? ' Cameras running in accessory mode with Rebroadcast Prebuffers will send a notification when the stream becomes unavailable.'
                    : ''),
            type: 'boolean',
            onPut: (oldValue, newValue) => {
                if (oldValue !== undefined)
                    this.alertReload()
            },
            // todo: change this at some point.
            persistedDefaultValue: false,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<T>) {
        super(options);


        const hideStandalone = !this.storageSettings.values.standalone;
        // this may only change on reload of plugin.
        this.storageSettings.settings.qrCode.hide = hideStandalone;
        this.storageSettings.settings.pincode.hide = hideStandalone;
        this.storageSettings.settings.resetAccessory.hide = hideStandalone;
        this.storageSettings.settings.portOverride.hide = hideStandalone;
    }

    alertReload() {
        sdk.log.a(`The HomeKit plugin will reload momentarily for the changes to ${this.name} to take effect.`);
        sdk.deviceManager.requestRestart();
    }

    async getMixinSettings() {
        return this.storageSettings.getSettings();
    }

    async putMixinSetting(key: string, value: SettingValue) {
        this.storageSettings.putSetting(key, value);
    }
}
