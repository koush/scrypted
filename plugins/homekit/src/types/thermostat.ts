import { Fan, FanMode, HumidityMode, HumiditySensor, HumiditySetting, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode, AirQualitySensor, AirQuality, PM10Sensor, PM25Sensor, VOCSensor, NOXSensor, CO2Sensor } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice,  } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { addAirQualitySensor, addCarbonDioxideSensor, addFan, makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.Thermostat,
    probe(device: DummyDevice) {
        if (!device.interfaces.includes(ScryptedInterface.TemperatureSetting) || !device.interfaces.includes(ScryptedInterface.Thermometer))
            return false;
        return true;
    },
    getAccessory: async (device: ScryptedDevice & TemperatureSetting & Thermometer & HumiditySensor & OnOff & Fan & HumiditySetting & AirQualitySensor & PM10Sensor & PM25Sensor & VOCSensor & NOXSensor & CO2Sensor, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);
        const service = accessory.addService(Service.Thermostat, device.name);
        service.setPrimaryService();

        const minStep = 0.1;
        const minSetTemp = 10 // 50F
        const maxSetTemp = 32.222 // 90F
        const minGetTemp = -17.7778 // 0F
        const maxGetTemp = 71.1111 // 160F

        service.getCharacteristic(Characteristic.CurrentTemperature).setProps({
            minStep: minStep,
            minValue: minGetTemp, // default = -270, change to -20C or 0F (-17.7778C)
            maxValue: maxGetTemp // default = 100, change to 60C or 160F (71.1111C)
        });

        service.getCharacteristic(Characteristic.TargetTemperature).setProps({
            minStep: minStep, // 0.1
            minValue: minSetTemp, // default = 10, change to 9C or 50F (10C)
            maxValue: maxSetTemp // default = 38, change to 32C or 90F (32.2222C)
        });

        service.getCharacteristic(Characteristic.CoolingThresholdTemperature).setProps({
            minStep: minStep, // 0.1
            minValue: minSetTemp, // default = 10, change to 9C or 50F (10C)
            maxValue: maxSetTemp // default = 35, change to 32C or 90F (32.2222C)
        });
        
        service.getCharacteristic(Characteristic.HeatingThresholdTemperature).setProps({
            minStep: minStep, // 0.1
            minValue: minSetTemp, // default = 0, change to 9C or 50F (10C)
            maxValue: maxSetTemp // default = 25, change to 32C or 90F (32.2222C)
        });

        function toCurrentMode(mode: ThermostatMode) {
            switch (mode) {
                case ThermostatMode.Off:
                    return Characteristic.CurrentHeatingCoolingState.OFF;
                case ThermostatMode.Cool:
                    return Characteristic.CurrentHeatingCoolingState.COOL;
                case ThermostatMode.Heat:
                    return Characteristic.CurrentHeatingCoolingState.HEAT;
            }
            return Characteristic.CurrentHeatingCoolingState.HEAT;
        }

        function toTargetMode(mode: ThermostatMode) {
            switch (mode) {
                case ThermostatMode.Off:
                    return Characteristic.TargetHeatingCoolingState.OFF;
                case ThermostatMode.Cool:
                    return Characteristic.TargetHeatingCoolingState.COOL;
                case ThermostatMode.Heat:
                    return Characteristic.TargetHeatingCoolingState.HEAT;
                case ThermostatMode.Auto:
                    return Characteristic.TargetHeatingCoolingState.AUTO;
            }
            return Characteristic.TargetHeatingCoolingState.AUTO;
        }

        function fromTargetMode(mode: number) {
            switch (mode) {
                case Characteristic.TargetHeatingCoolingState.OFF:
                    return ThermostatMode.Off;
                case Characteristic.TargetHeatingCoolingState.HEAT:
                    return ThermostatMode.Heat;
                case Characteristic.TargetHeatingCoolingState.COOL:
                    return ThermostatMode.Cool;
                case Characteristic.TargetHeatingCoolingState.AUTO:
                    return ThermostatMode.Auto;
            }
        }

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.CurrentHeatingCoolingState,
            () => toCurrentMode(device.thermostatActiveMode));

        service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setThermostatMode(fromTargetMode(value as number));
            })

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.TargetHeatingCoolingState,
            () => toTargetMode(device.thermostatMode));

        service.getCharacteristic(Characteristic.TargetTemperature)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setThermostatSetpoint(value as number);
            });

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.TargetTemperature,
            () => Math.max(device.thermostatSetpoint || 0, 10));

        service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setThermostatSetpointLow(value as number);
            });

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.HeatingThresholdTemperature,
            () => Math.max(device.thermostatSetpointLow || 0, 10));

        service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setThermostatSetpointHigh(value as number);
            });

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.CoolingThresholdTemperature,
            () => Math.max(device.thermostatSetpointHigh || 0, 10));

        bindCharacteristic(device, ScryptedInterface.Thermometer, service, Characteristic.TemperatureDisplayUnits,
            () => device.temperatureUnit === TemperatureUnit.F ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS);

        service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setTemperatureUnit(value === Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? TemperatureUnit.F : TemperatureUnit.C);
            });

        bindCharacteristic(device, ScryptedInterface.Thermometer, service, Characteristic.CurrentTemperature,
            () => device.temperature || 0);

        if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
            bindCharacteristic(device, ScryptedInterface.HumiditySensor, service, Characteristic.CurrentRelativeHumidity,
                () => device.humidity || 0);
        }

        if (device.interfaces.includes(ScryptedInterface.HumiditySetting) && device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
            const humidityService = accessory.addService(Service.HumidifierDehumidifier);

            bindCharacteristic(device, ScryptedInterface.HumiditySetting, humidityService, Characteristic.Active,
                () => {
                    if (!device.humiditySetting?.mode)
                        return false;
                    if (device.humiditySetting.mode === HumidityMode.Off)
                        return false;
                    return true;
                });
            humidityService.getCharacteristic(Characteristic.Active).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                device.setHumidity({
                    mode: value ? HumidityMode.Auto : HumidityMode.Off
                });
            });

            bindCharacteristic(device, ScryptedInterface.HumiditySensor, humidityService, Characteristic.CurrentRelativeHumidity,
                () => device.humidity || 0);

            bindCharacteristic(device, ScryptedInterface.HumiditySetting, humidityService, Characteristic.CurrentHumidifierDehumidifierState,
                () => !device.humiditySetting?.activeMode
                    ? Characteristic.CurrentHumidifierDehumidifierState.INACTIVE
                    : device.humiditySetting.activeMode === HumidityMode.Dehumidify
                        ? Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
                        : device.humiditySetting.activeMode === HumidityMode.Humidify
                            ? Characteristic.CurrentHumidifierDehumidifierState.HUMIDIFYING
                            : Characteristic.CurrentHumidifierDehumidifierState.IDLE);

            bindCharacteristic(device, ScryptedInterface.HumiditySetting, humidityService, Characteristic.TargetHumidifierDehumidifierState,
                () => !device.humiditySetting?.mode || device.humiditySetting?.mode === HumidityMode.Auto
                    ? Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER_OR_DEHUMIDIFIER
                    : device.humiditySetting?.mode === HumidityMode.Dehumidify
                        ? Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER
                        : Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER);
            humidityService.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                device.setHumidity({
                    mode: value === Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER
                        ? HumidityMode.Humidify
                        : value === Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER
                            ? HumidityMode.Dehumidify
                            : HumidityMode.Auto
                });
            });

            bindCharacteristic(device, ScryptedInterface.HumiditySetting, humidityService, Characteristic.RelativeHumidityHumidifierThreshold,
                () => device.humiditySetting?.humidifierSetpoint || 0);
            humidityService.getCharacteristic(Characteristic.RelativeHumidityHumidifierThreshold).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                device.setHumidity({
                    humidifierSetpoint: value as number,
                });
            });

            bindCharacteristic(device, ScryptedInterface.HumiditySetting, humidityService, Characteristic.RelativeHumidityDehumidifierThreshold,
                () => device.humiditySetting?.dehumidifierSetpoint || 0);
            humidityService.getCharacteristic(Characteristic.RelativeHumidityDehumidifierThreshold).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                device.setHumidity({
                    dehumidifierSetpoint: value as number,
                });
            });
        }

        addFan(device, accessory);
        addAirQualitySensor(device, accessory);
        addCarbonDioxideSensor(device, accessory);

        return accessory;
    },
});
