import sdk, { ScryptedDevice } from "@scrypted/sdk";
import {  } from "../common";
import { Accessory, uuid } from '../hap';
import type { HomeKitPlugin } from "../main";

const { deviceManager } = sdk;

export function makeAccessory(device: ScryptedDevice, homekitPlugin: HomeKitPlugin, suffix?: string): Accessory {
    const mixinStorage = deviceManager.getMixinStorage(device.id, homekitPlugin.nativeId);
    const resetId = mixinStorage.getItem('resetAccessory') || '';
    return new Accessory(device.name, uuid.generate(resetId + device.id + (suffix ? '-' + suffix : '')));
}
