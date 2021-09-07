
import { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, Service } from '../hap';
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

        bindCharacteristic(device, ScryptedInterface.BinarySensor, service, Characteristic.ContactSensorState,
            () => !!device.binaryState);

        return accessory;
    }
});
