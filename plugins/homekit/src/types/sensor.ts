
import { MotionSensor, BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Thermometer } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Sensor,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.Thermometer) || device.interfaces.includes(ScryptedInterface.BinarySensor) || device.interfaces.includes(ScryptedInterface.MotionSensor);
    },
    getAccessory: async (device: ScryptedDevice & BinarySensor & MotionSensor & Thermometer) => {
        const accessory = makeAccessory(device);

        if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
            const contactSensorService = accessory.addService(Service.ContactSensor, device.name);
            contactSensorService.getCharacteristic(Characteristic.ContactSensorState)

            bindCharacteristic(device, ScryptedInterface.BinarySensor, contactSensorService, Characteristic.ContactSensorState,
                () => !!device.binaryState);
        }

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            const motionSensorService = accessory.addService(Service.MotionSensor, device.name);

            bindCharacteristic(device, ScryptedInterface.MotionSensor, motionSensorService, Characteristic.MotionDetected,
                () => !!device.motionDetected, true);
        }

        if (device.interfaces.includes(ScryptedInterface.Thermometer)) {
            const service = accessory.addService(Service.TemperatureSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.Thermometer, service, Characteristic.CurrentTemperature,
                () => device.temperature || 0);

        }

        // todo: more sensors.
        return accessory;
    }
});
