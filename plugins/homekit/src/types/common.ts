import { ScryptedDevice } from "@scrypted/sdk";
import { uuid, Accessory } from '../hap';

export function makeAccessory(device: ScryptedDevice, suffix?: string): Accessory {
    return new Accessory(device.name, uuid.generate(device.id + (suffix ? '-' + suffix : '')));
}
