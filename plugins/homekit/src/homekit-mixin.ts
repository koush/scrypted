import { StorageSettings } from "@scrypted/common/src/settings";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import sdk, { ScryptedInterface, SettingValue } from "@scrypted/sdk";
import crypto from 'crypto';
import { createHAPUsernameStorageSettingsDict } from "./hap-utils";
const { log } = sdk;

export const HOMEKIT_MIXIN = 'mixin:@scrypted/homekit';

export class HomekitMixin<T> extends SettingsMixinDeviceBase<T> {
    storageSettings = new StorageSettings(this, {
        standalone: {
            group: 'HomeKit Pairing',
            title: 'Standalone Accessory Mode',
            description: 'Advertise this to HomeKit as a standalone accessory rather than through the Scrypted HomeKit bridge. Enabling this option will remove it from the bridge. The accessory will then need to be re-paired to HomeKit. The pairing code will be available after the HomeKit plugin has been reloaded.'
                + (this.interfaces.includes(ScryptedInterface.VideoCamera)
                    ? ' Cameras running in accessory mode with Rebroadcast Prebuffers will send a notification when the stream becomes unavailable.'
                    : ''),
            type: 'boolean',
            onPut: () => this.alertReload(),
            // todo: change this at some point.
            persistedDefaultValue: false,
        },
        ...createHAPUsernameStorageSettingsDict('HomeKit Pairing'),
        resetAccessory: {
            group: 'HomeKit Pairing',
            title: 'Reset Pairing',
            description: 'Resetting the pairing will resync it to HomeKit as a new device. Bridged devices will automatically relink as a new device. Accessory devices must be manually removed from the Home app and re-paired. Enter RESET to reset the pairing.',
            placeholder: 'RESET',
            mapPut: (oldValue, newValue) => {
                if (newValue === 'RESET') {
                    this.storage.removeItem(this.storageSettings.keys.mac);
                    this.alertReload();
                    // generate a new reset accessory random value.
                    return crypto.randomBytes(8).toString('hex');
                }
                throw new Error('HomeKit Accessory Reset cancelled.');
            },
            mapGet: () => '',
        },
    });

    constructor(options: SettingsMixinDeviceOptions<T>) {
        super(options);

        // this may only change on reload of plugin.
        this.storageSettings.settings.qrCode.hide = !this.storageSettings.values.standalone;
        this.storageSettings.settings.pincode.hide = !this.storageSettings.values.standalone;
    }

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
