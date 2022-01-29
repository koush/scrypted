
import { MotionSensor, BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Thermometer, HumiditySensor, AudioSensor, AmbientLightSensor, OccupancySensor } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, Service } from '../hap';
import { makeAccessory } from './common';

const supportedSensors: string[] = [
    ScryptedInterface.Thermometer,
    ScryptedInterface.BinarySensor,
    ScryptedInterface.OccupancySensor,
    ScryptedInterface.AmbientLightSensor,
    ScryptedInterface.AudioSensor,
    ScryptedInterface.MotionSensor,
    ScryptedInterface.Thermometer,
    ScryptedInterface.HumiditySensor,
];

addSupportedType({
    type: ScryptedDeviceType.Sensor,
    probe(device: DummyDevice) {
        for (const iface of device.interfaces) {
            if (supportedSensors.includes(iface))
                return true;
        }
        return false;
    },
    getAccessory: async (device: ScryptedDevice & OccupancySensor & AmbientLightSensor & AmbientLightSensor & AudioSensor & BinarySensor & MotionSensor & Thermometer & HumiditySensor) => {
        const accessory = makeAccessory(device);

        if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
            const service = accessory.addService(Service.ContactSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.BinarySensor, service, Characteristic.ContactSensorState,
                () => !!device.binaryState);
        }

        if (device.interfaces.includes(ScryptedInterface.OccupancySensor)) {
            const service = accessory.addService(Service.OccupancySensor, device.name);
            bindCharacteristic(device, ScryptedInterface.OccupancySensor, service, Characteristic.OccupancyDetected,
                () => !!device.occupied);
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
