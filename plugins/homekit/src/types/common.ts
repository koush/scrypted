import { MotionSensor, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { uuid, Accessory, Characteristic, CharacteristicEventTypes, NodeCallback, CharacteristicValue, Service } from '../hap';
import { listenCharacteristic } from "../common";

export function makeAccessory(device: ScryptedDevice): Accessory {
    return new Accessory(device.name, uuid.generate(device.id));
}
