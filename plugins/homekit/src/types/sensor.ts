
import { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, DummyDevice, listenCharacteristic } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Sensor,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.BinarySensor);
    },
    getAccessory: (device: ScryptedDevice & BinarySensor) => {
        const accessory = makeAccessory(device);
        const service = accessory.addService(Service.ContactSensor, device.name);
        service.getCharacteristic(Characteristic.ContactSensorState)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, !!device.binaryState);
            });

        listenCharacteristic(device, ScryptedInterface.BinarySensor, service, Characteristic.ContactSensorState);

        return accessory;
    }
});
