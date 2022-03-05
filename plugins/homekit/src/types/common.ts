import sdk, { ScryptedDevice } from "@scrypted/sdk";
import { HomeKitSession } from "../common";
import { Accessory, uuid } from '../hap';

const { deviceManager } = sdk;

export function makeAccessory(device: ScryptedDevice, homekitSession: HomeKitSession, suffix?: string): Accessory {
    const mixinStorage = deviceManager.getMixinStorage(device.id, homekitSession.nativeId);
    const resetId = mixinStorage.getItem('resetAccessory') || '';
    return new Accessory(device.name, uuid.generate(resetId + device.id + (suffix ? '-' + suffix : '')));
}
