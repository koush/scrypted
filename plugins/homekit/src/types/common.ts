import { MotionSensor, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { uuid, Accessory, Characteristic, CharacteristicEventTypes, NodeCallback, CharacteristicValue, Service } from '../hap';
import { listenCharacteristic } from "../common";

export function makeAccessory(device: ScryptedDevice): Accessory {
    return new Accessory(device.name, uuid.generate(device.id));
}

export function maybeAddMotionSensor(device: ScryptedDevice & MotionSensor, accessory: Accessory) {
    if (!device.interfaces.includes(ScryptedInterface.MotionSensor))
        return;
    
    const service = accessory.addService(Service.MotionSensor);
    service.getCharacteristic(Characteristic.MotionDetected)
    .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
        callback(null, !!device.motionDetected);
    });

    listenCharacteristic(device, ScryptedInterface.MotionSensor, service, Characteristic.MotionDetected, true);

    return service;
}
