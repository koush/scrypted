
import { MotionSensor, BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Thermometer, HumiditySensor, AudioSensor } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Sensor,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.Thermometer) || device.interfaces.includes(ScryptedInterface.BinarySensor) || device.interfaces.includes(ScryptedInterface.MotionSensor);
    },
    getAccessory: async (device: ScryptedDevice & AudioSensor & BinarySensor & MotionSensor & Thermometer & HumiditySensor) => {
        const accessory = makeAccessory(device);

        if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
            const contactSensorService = accessory.addService(Service.ContactSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.BinarySensor, contactSensorService, Characteristic.ContactSensorState,
                () => !!device.binaryState);
        }

        if (device.interfaces.includes(ScryptedInterface.AudioSensor)) {
            const service = accessory.addService(Service.ContactSensor, device.name + ' Alarm Sound', 'AudioSensor');
            bindCharacteristic(device, ScryptedInterface.AudioSensor, service, Characteristic.ContactSensorState,
                () => !!device.audioDetected);
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

        if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
            const service = accessory.addService(Service.HumiditySensor, device.name);
            bindCharacteristic(device, ScryptedInterface.HumiditySensor, service, Characteristic.CurrentRelativeHumidity,
                () => device.humidity || 0);
        }

        // todo: more sensors.
        return accessory;
    }
});
