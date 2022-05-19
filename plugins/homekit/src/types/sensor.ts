import { AmbientLightSensor, AudioSensor, BinarySensor, FloodSensor, HumiditySensor, MotionSensor, OccupancySensor, PM25Sensor, AirQualitySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Thermometer, VOCSensor, AirQuality, EntrySensor, TamperSensor } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice,  } from '../common';
import { Characteristic, Service } from '../hap';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";

function airQualityToHomekit(airQuality: AirQuality) {
    switch (airQuality) {
        case AirQuality.Excellent:
            return Characteristic.AirQuality.EXCELLENT;
        case AirQuality.Good:
            return Characteristic.AirQuality.GOOD;
        case AirQuality.Fair:
            return Characteristic.AirQuality.FAIR;
        case AirQuality.Inferior:
            return Characteristic.AirQuality.INFERIOR;
        case AirQuality.Poor:
            return Characteristic.AirQuality.POOR;
    }
    return Characteristic.AirQuality.UNKNOWN;
}

const supportedSensors: string[] = [
    ScryptedInterface.Thermometer,
    ScryptedInterface.BinarySensor,
    ScryptedInterface.OccupancySensor,
    ScryptedInterface.AmbientLightSensor,
    ScryptedInterface.AudioSensor,
    ScryptedInterface.MotionSensor,
    ScryptedInterface.Thermometer,
    ScryptedInterface.HumiditySensor,
    ScryptedInterface.FloodSensor,
    ScryptedInterface.AirQualitySensor,
    ScryptedInterface.PM25Sensor,
    ScryptedInterface.VOCSensor,
    ScryptedInterface.EntrySensor,
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
    getAccessory: async (device: ScryptedDevice & OccupancySensor & AmbientLightSensor & AmbientLightSensor & AudioSensor & BinarySensor & MotionSensor & Thermometer & HumiditySensor & FloodSensor & AirQualitySensor & PM25Sensor & VOCSensor & EntrySensor & TamperSensor, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);

        if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
            const service = accessory.addService(Service.ContactSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.BinarySensor, service, Characteristic.ContactSensorState,
                () => !!device.binaryState);
        } else if (device.interfaces.includes(ScryptedInterface.EntrySensor)) {
            const service = accessory.addService(Service.ContactSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.EntrySensor, service, Characteristic.ContactSensorState,
                () => !!device.entryOpen);
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

        if (device.interfaces.includes(ScryptedInterface.FloodSensor)) {
            const service = accessory.addService(Service.LeakSensor, device.name);
            bindCharacteristic(device, ScryptedInterface.FloodSensor, service, Characteristic.LeakDetected,
                () => !!device.flooded);
        }

        if (device.interfaces.includes(ScryptedInterface.AirQualitySensor)) {
            const service = accessory.addService(Service.AirQualitySensor, device.name);
            bindCharacteristic(device, ScryptedInterface.AirQualitySensor, service, Characteristic.AirQuality,
                () => airQualityToHomekit(device.airQuality));
            bindCharacteristic(device, ScryptedInterface.PM25Sensor, service, Characteristic.PM2_5Density,
                () => device.pm25Density || 0);
            bindCharacteristic(device, ScryptedInterface.VOCSensor, service, Characteristic.VOCDensity,
                () => device.vocDensity || 0);
        }

        // todo: more sensors.

        const tamperServices: typeof Service[] = [
            Service.ContactSensor,
            Service.AirQualitySensor,
            Service.CarbonDioxideSensor,
            Service.CarbonMonoxideSensor,
            Service.HumiditySensor,
            Service.LeakSensor,
            Service.LightSensor,
            Service.MotionSensor,
            Service.OccupancySensor,
            Service.SecuritySystem,
            Service.SmokeSensor,
            Service.TemperatureSensor,
        ];

        if (device.interfaces.includes(ScryptedInterface.TamperSensor)) {
            for (const service of accessory.services) {
                for (const tamperEligibleService of tamperServices) {
                    if (service instanceof tamperEligibleService) {
                        bindCharacteristic(device, ScryptedInterface.TamperSensor, service, Characteristic.StatusTampered,
                            () => (device.tampered ? 1 : 0));
                    }
                }
            }
        }

        return accessory;
    }
});
