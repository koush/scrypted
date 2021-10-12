
import { MotionSensor, BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Sensor,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.BinarySensor) || device.interfaces.includes(ScryptedInterface.MotionSensor);
    },
    getAccessory: async (device: ScryptedDevice & BinarySensor & MotionSensor) => {
        const accessory = makeAccessory(device);

        if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
            const contactSensorService = accessory.addService(Service.ContactSensor, device.name);
            contactSensorService.getCharacteristic(Characteristic.ContactSensorState)
    
            bindCharacteristic(device, ScryptedInterface.BinarySensor, contactSensorService, Characteristic.ContactSensorState,
                () => !!device.binaryState);
        }

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            const motionSensorService = accessory.addService(Service.MotionSensor, device.name);
            motionSensorService.getCharacteristic(Characteristic.MotionDetected)
                .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                    callback(null, !!device.motionDetected);
                });
    
                device.listen({
                event: ScryptedInterface.MotionSensor,
                watch: false,
            }, (eventSource, eventDetails, data) => {
                motionSensorService.updateCharacteristic(Characteristic.MotionDetected, !!device.motionDetected);
            });
        }

        // todo: more sensors.

        return accessory;
    }
});
