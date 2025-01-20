import { Fan, FanMode, HumidityMode, HumiditySensor, HumiditySetting, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode, AirQualitySensor, AirQuality, PM10Sensor, PM25Sensor, VOCSensor, NOXSensor, CO2Sensor, HumiditySettingStatus } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice, } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { addAirQualitySensor, addCarbonDioxideSensor, addFan, addHumiditySetting, makeAccessory } from './common';
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
                case ThermostatMode.HeatCool:
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
                    if (device.temperatureSetting?.availableModes?.includes(ThermostatMode.HeatCool)) {
                        return ThermostatMode.HeatCool;
                    } else {
                        return ThermostatMode.Auto;
                    }
            }
        }

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.CurrentHeatingCoolingState,
            () => toCurrentMode(device.temperatureSetting?.activeMode));

        service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setTemperature({
                    mode: fromTargetMode(value as number),
                });
            })

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.TargetHeatingCoolingState,
            () => toTargetMode(device.temperatureSetting?.mode));

        if (!device.temperatureSetting?.availableModes?.includes(ThermostatMode.Auto) &&
            !device.temperatureSetting?.availableModes?.includes(ThermostatMode.HeatCool)) {
            service.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps({
                maxValue: Characteristic.TargetHeatingCoolingState.COOL // Disable 'Auto' mode
            });
        }

        service.getCharacteristic(Characteristic.TargetTemperature)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setTemperature({
                    setpoint: value as number,
                });
            });

        const getSetPoint = (index: number) => Math.max((device.temperatureSetting?.setpoint instanceof Array ? device.temperatureSetting?.setpoint[index] : device.temperatureSetting?.setpoint) || 0, 10);

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.TargetTemperature,
            () => getSetPoint(0));

        if (device.temperatureSetting?.availableModes?.includes(ThermostatMode.HeatCool)) {
            let debounceTimeout: NodeJS.Timeout;
            let l: number;
            let h: number;
            const debounce = () => {
                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    device.setTemperature({
                        setpoint: [l || h, h || l],
                    })
                }, 5000);
            };

            service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    l = value as number;
                    debounce();
                });


            bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.HeatingThresholdTemperature,
                () => getSetPoint(0));

            service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    h = value as number;
                    debounce();
                });

            bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.CoolingThresholdTemperature,
                () => getSetPoint(1));

            // sets props after binding initial state to avoid warnings in logs
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
        }

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

        // add fan state to thermostat service even though it is not required or optional, 
        // in order to expose to Home Assistant HomeKit Controller under their climate entity
        if (device.interfaces.includes(ScryptedInterface.Fan)) {
            bindCharacteristic(device, ScryptedInterface.Fan, service, Characteristic.TargetFanState,
                () => device.fan?.mode === FanMode.Manual
                    ? Characteristic.TargetFanState.MANUAL
                    : Characteristic.TargetFanState.AUTO);

            service.getCharacteristic(Characteristic.TargetFanState).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                device.setFan({
                    mode: value === Characteristic.TargetFanState.MANUAL ? FanMode.Manual : FanMode.Auto,
                });
            });

            bindCharacteristic(device, ScryptedInterface.Fan, service, Characteristic.CurrentFanState,
                () => !device.fan?.active
                    ? Characteristic.CurrentFanState.INACTIVE
                    : !device.fan.speed
                        ? Characteristic.CurrentFanState.IDLE
                        : Characteristic.CurrentFanState.BLOWING_AIR);
        }

        // add relataive target humidity to thermostat service even though it is not required or optional, 
        // in order to expose to Home Assistant HomeKit Controller under their climate entity
        if (device.interfaces.includes(ScryptedInterface.HumiditySetting)) {
            function targetHumidity(setting: HumiditySettingStatus) {
                if (!setting)
                    return 0;

                if (setting?.availableModes.includes(HumidityMode.Humidify) 
                    && setting?.availableModes.includes(HumidityMode.Dehumidify)) {
                    if (setting?.activeMode === HumidityMode.Humidify)
                        return setting?.humidifierSetpoint;
                    if (setting?.activeMode === HumidityMode.Dehumidify)
                        return setting?.dehumidifierSetpoint;

                    return 0;
                }

                if (setting?.availableModes.includes(HumidityMode.Humidify))
                    return setting?.humidifierSetpoint;

                if (setting?.availableModes.includes(HumidityMode.Dehumidify))
                    return setting?.dehumidifierSetpoint;

                return 0;
            }

            bindCharacteristic(device, ScryptedInterface.HumiditySetting, service, Characteristic.TargetRelativeHumidity,
                () => targetHumidity(device.humiditySetting));
        }

        addHumiditySetting(device, accessory);
        addFan(device, accessory);
        addAirQualitySensor(device, accessory);
        addCarbonDioxideSensor(device, accessory);

        return accessory;
    },
});
