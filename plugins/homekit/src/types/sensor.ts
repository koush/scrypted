
import { MotionSensor, BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Thermometer, HumiditySensor, AudioSensor, AmbientLightSensor } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Sensor,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.Thermometer) || device.interfaces.includes(ScryptedInterface.BinarySensor) || device.interfaces.includes(ScryptedInterface.MotionSensor);
    },
    getAccessory: async (device: ScryptedDevice & AmbientLightSensor & AudioSensor & BinarySensor & MotionSensor & Thermometer & HumiditySensor) => {
        const accessory = makeAccessory(device);

        if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
            const service = accessory.addService(Service.ContactSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.BinarySensor, service, Characteristic.ContactSensorState,
                () => !!device.binaryState);
        }

        if (device.interfaces.includes(ScryptedInterface.AmbientLightSensor)) {
            const service = accessory.addService(Service.LightSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.AmbientLightSensor, service, Characteristic.CurrentAmbientLightLevel,
                () => device.ambientLight || 0);
        }

        if (device.interfaces.includes(ScryptedInterface.AudioSensor)) {
            const service = accessory.addService(Service.ContactSensor, device.name + ' Alarm Sound', 'AudioSensor');
            bindCharacteristic(device, ScryptedInterface.AudioSensor, service, Characteristic.ContactSensorState,
                () => !!device.audioDetected);
        }

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            const service = accessory.addService(Service.MotionSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.MotionSensor, service, Characteristic.MotionDetected,
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
