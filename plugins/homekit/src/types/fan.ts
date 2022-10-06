import { Fan, FanMode, HumidityMode, HumiditySensor, HumiditySetting, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode, AirQualitySensor, AirQuality, PM10Sensor, PM25Sensor, VOCSensor, NOXSensor, CO2Sensor } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { addAirQualitySensor, addCarbonDioxideSensor, addFan, makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";
import { probe } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Fan,
    probe(device: DummyDevice) {
        if (!device.interfaces.includes(ScryptedInterface.Fan))
            return false;
        return true;
    },
    getAccessory: async (device: ScryptedDevice & TemperatureSetting & Thermometer & HumiditySensor & OnOff & Fan & HumiditySetting & AirQualitySensor & PM10Sensor & PM25Sensor & VOCSensor & NOXSensor & CO2Sensor, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);
        const service = addFan(device, accessory);
        service.setPrimaryService();

        if (device.interfaces.includes(ScryptedInterface.TemperatureSetting) && device.interfaces.includes(ScryptedInterface.Thermometer)) {
            const heaterCoolerService = accessory.addService(Service.HeaterCooler);

            const minStep = 0.1;
            const minSetTemp = 10 // 50F
            const maxSetTemp = 32.222 // 90F
            const minGetTemp = -17.7778 // 0F
            const maxGetTemp = 71.1111 // 160F
    
            function toCurrentMode(mode: ThermostatMode) {
                switch (mode) {
                    case ThermostatMode.Off:
                        return Characteristic.CurrentHeaterCoolerState.IDLE;
                    case ThermostatMode.Cool:
                        return Characteristic.CurrentHeaterCoolerState.COOLING;
                    case ThermostatMode.Heat:
                        return Characteristic.CurrentHeaterCoolerState.HEATING;
                }
            }
    
            function toTargetMode(mode: ThermostatMode) {
                switch (mode) {
                    case ThermostatMode.Cool:
                        return Characteristic.TargetHeaterCoolerState.COOL;
                    case ThermostatMode.Heat:
                        return Characteristic.TargetHeaterCoolerState.HEAT;
                    case ThermostatMode.Auto:
                        return Characteristic.TargetHeaterCoolerState.AUTO;
                }
            }
    
            function fromTargetMode(mode: number) {
                switch (mode) {
                    case Characteristic.TargetHeaterCoolerState.HEAT:
                        return ThermostatMode.Heat;
                    case Characteristic.TargetHeaterCoolerState.COOL:
                        return ThermostatMode.Cool;
                    case Characteristic.TargetHeaterCoolerState.AUTO:
                        return ThermostatMode.Auto;
                }
            }

            heaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature).setProps({
                minStep: minStep,
                minValue: minGetTemp, // default = -270, change to -20C or 0F (-17.7778C)
                maxValue: maxGetTemp // default = 100, change to 60C or 160F (71.1111C)
            });
    
            heaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature).setProps({
                minStep: minStep, // 0.1
                minValue: minSetTemp, // default = 10, change to 9C or 50F (10C)
                maxValue: maxSetTemp // default = 35, change to 32C or 90F (32.2222C)
            });
            
            heaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature).setProps({
                minStep: minStep, // 0.1
                minValue: minSetTemp, // default = 0, change to 9C or 50F (10C)
                maxValue: maxSetTemp // default = 25, change to 32C or 90F (32.2222C)
            });
    
            let targetState: number[] = [];

            for (const mode of device.thermostatAvailableModes) {
                const hkMode = toTargetMode(mode);

                if (hkMode && !targetState.includes(hkMode))
                    targetState.push(hkMode);
            }

            targetState.sort();

            const minTargetState = targetState[0];
            const maxTargetState = targetState[targetState.length -1];

            heaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).setProps({
                maxValue: maxTargetState,
                minValue: minTargetState,
                validValues: targetState
            });

            let currentState: number[] = [];

            for (const mode of device.thermostatAvailableModes) {
                const hkMode = toCurrentMode(mode);

                if (hkMode && !currentState.includes(hkMode))
                    currentState.push(hkMode);
            }

            currentState.sort();

            const minCurrentState = currentState[0];
            const maxCurrentState = currentState[currentState.length -1];

            heaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).setProps({
                maxValue: maxCurrentState,
                minValue: minCurrentState,
                validValues: currentState
            });

            bindCharacteristic(device, ScryptedInterface.TemperatureSetting, heaterCoolerService, Characteristic.Active,
                () => device.thermostatActiveMode !== ThermostatMode.Off);
    
            heaterCoolerService.getCharacteristic(Characteristic.Active).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                if (value)
                    device.setThermostatMode(ThermostatMode.On);
                else
                    device.setThermostatMode(ThermostatMode.Off);
            });

            bindCharacteristic(device, ScryptedInterface.TemperatureSetting, heaterCoolerService, Characteristic.CurrentHeaterCoolerState,() => {
                const mode = device.thermostatActiveMode;
                const s = toCurrentMode(mode);
                return s ?? minCurrentState;
            });
    
            heaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();

                    const s = fromTargetMode(value as number);
                    device.setThermostatMode(s ?? ThermostatMode.Off);
                })
    
            bindCharacteristic(device, ScryptedInterface.TemperatureSetting, heaterCoolerService, Characteristic.TargetHeaterCoolerState,() => {
                const mode = device.thermostatMode;
                const s = toTargetMode(mode);
                return s ?? minTargetState;
            });
    
            heaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    device.setThermostatSetpoint(value as number);
                });
    
            bindCharacteristic(device, ScryptedInterface.TemperatureSetting, heaterCoolerService, Characteristic.HeatingThresholdTemperature,
                () => Math.max(device.thermostatSetpoint || 0, 10));
    
            heaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    device.setThermostatSetpoint(value as number);
                });
    
            bindCharacteristic(device, ScryptedInterface.TemperatureSetting, heaterCoolerService, Characteristic.CoolingThresholdTemperature,
                () => Math.max(device.thermostatSetpoint || 0, 10));
    
            bindCharacteristic(device, ScryptedInterface.Thermometer, heaterCoolerService, Characteristic.CurrentTemperature,
                () => device.temperature || 0);

            bindCharacteristic(device, ScryptedInterface.Thermometer, heaterCoolerService, Characteristic.TemperatureDisplayUnits,
                () => device.temperatureUnit === TemperatureUnit.F ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS);
    
            heaterCoolerService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    device.setTemperatureUnit(value === Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? TemperatureUnit.F : TemperatureUnit.C);
                });

            if (device.fan?.swing !== undefined) {
                bindCharacteristic(device, ScryptedInterface.Fan, heaterCoolerService, Characteristic.SwingMode,
                    () => device.fan?.swing ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
                heaterCoolerService.getCharacteristic(Characteristic.SwingMode).on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    device.setFan({
                        swing: value === Characteristic.SwingMode.SWING_ENABLED,
                    });
                });
            }
    
            if (device.fan?.maxSpeed !== undefined) {
                bindCharacteristic(device, ScryptedInterface.Fan, heaterCoolerService, Characteristic.RotationSpeed,
                    () => {
                        const speed = device.fan?.speed;
                        if (!speed)
                            return 0;
                        const maxSpeed = device.fan?.maxSpeed;
                        if (!maxSpeed)
                            return 100;
                        const fraction = speed / maxSpeed;
                        return Math.abs(Math.round(fraction * 100));
                    });
                heaterCoolerService.getCharacteristic(Characteristic.RotationSpeed).on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    const maxSpeed = device.fan?.maxSpeed;
                    const speed = maxSpeed
                        ? Math.round((value as number) / 100 * maxSpeed)
                        : 1;
                    device.setFan({
                        speed,
                    });
                });
            }

        } else if (device.interfaces.includes(ScryptedInterface.Thermometer)) {
            const tempSensorService = accessory.addService(Service.TemperatureSensor);
            bindCharacteristic(device, ScryptedInterface.Thermometer, tempSensorService, Characteristic.CurrentTemperature,
                () => device.temperature || 0);
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

            if (device.fan?.swing !== undefined) {
                bindCharacteristic(device, ScryptedInterface.Fan, humidityService, Characteristic.SwingMode,
                    () => device.fan?.swing ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
                humidityService.getCharacteristic(Characteristic.SwingMode).on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    device.setFan({
                        swing: value === Characteristic.SwingMode.SWING_ENABLED,
                    });
                });
            }
    
            if (device.fan?.maxSpeed !== undefined) {
                bindCharacteristic(device, ScryptedInterface.Fan, humidityService, Characteristic.RotationSpeed,
                    () => {
                        const speed = device.fan?.speed;
                        if (!speed)
                            return 0;
                        const maxSpeed = device.fan?.maxSpeed;
                        if (!maxSpeed)
                            return 100;
                        const fraction = speed / maxSpeed;
                        return Math.abs(Math.round(fraction * 100));
                    });
                humidityService.getCharacteristic(Characteristic.RotationSpeed).on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    const maxSpeed = device.fan?.maxSpeed;
                    const speed = maxSpeed
                        ? Math.round((value as number) / 100 * maxSpeed)
                        : 1;
                    device.setFan({
                        speed,
                    });
                });
            }
        } else if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
            const humiditySensorService = accessory.addService(Service.HumiditySensor);
            bindCharacteristic(device, ScryptedInterface.HumiditySensor, humiditySensorService, Characteristic.CurrentRelativeHumidity,
                () => device.humidity || 0);
        }

        addAirQualitySensor(device, accessory);
        addCarbonDioxideSensor(device, accessory);

        return accessory;
    },
});