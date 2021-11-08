
import { Fan, FanMode, HumiditySensor, HumiditySetting, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode } from '@scrypted/sdk'
import { Accessory } from 'hap-nodejs';
import { ROTATION_DIRECTION_CTYPE } from 'hap-nodejs/src/accessories/types';
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Thermostat,
    probe(device: DummyDevice) {
        if (!device.interfaces.includes(ScryptedInterface.TemperatureSetting) || !device.interfaces.includes(ScryptedInterface.Thermometer))
            return false;
        return true;
    },
    getAccessory: async (device: ScryptedDevice & TemperatureSetting & Thermometer & HumiditySensor & OnOff & Fan & HumiditySetting) => {
        const accessory = makeAccessory(device);
        const service = accessory.addService(Service.Thermostat, device.name);

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

        function getTargetTemperature() {
            return device.thermostatSetpoint ||
                ((device.thermostatSetpointHigh + device.thermostatSetpointLow) / 2) ||
                device.temperature;
        }

        service.getCharacteristic(Characteristic.TargetTemperature)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setThermostatSetpoint(value as number);
            });

        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.TargetTemperature,
            () => getTargetTemperature());


        bindCharacteristic(device, ScryptedInterface.TemperatureSetting, service, Characteristic.TemperatureDisplayUnits,
            () => device.temperatureUnit === TemperatureUnit.C ? Characteristic.TemperatureDisplayUnits.CELSIUS : Characteristic.TemperatureDisplayUnits.FAHRENHEIT);

        bindCharacteristic(device, ScryptedInterface.Thermometer, service, Characteristic.CurrentTemperature,
            () => device.temperature || 0);

        if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
            bindCharacteristic(device, ScryptedInterface.HumiditySensor, service, Characteristic.CurrentRelativeHumidity,
                () => device.humidity || 0);
        }

        if (device.interfaces.includes(ScryptedInterface.Fan)) {
            const fanService = accessory.addService(Service.Fanv2);

            bindCharacteristic(device, ScryptedInterface.Fan, fanService, Characteristic.On,
                () => !!device.fan?.speed);
            fanService.getCharacteristic(Characteristic.On).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                device.setFan({
                    speed: value ? device.fan?.maxSpeed || 1 : 0,
                    mode: FanMode.Manual,
                });
            });

            if (device.fan?.counterClockwise != null) {
                bindCharacteristic(device, ScryptedInterface.Fan, fanService, Characteristic.RotationDirection,
                    () => device.fan?.counterClockwise ? Characteristic.RotationDirection.COUNTER_CLOCKWISE : Characteristic.RotationDirection.CLOCKWISE);
                fanService.getCharacteristic(Characteristic.RotationDirection).on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    device.setFan({
                        counterClockwise: value === Characteristic.RotationDirection.COUNTER_CLOCKWISE,
                    });
                });
            }

            if (device.fan?.maxSpeed) {
                bindCharacteristic(device, ScryptedInterface.Fan, fanService, Characteristic.RotationSpeed,
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
                fanService.getCharacteristic(Characteristic.RotationSpeed).on(CharacteristicEventTypes.SET, (value, callback) => {
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

            if (device.fan?.availableModes) {
                bindCharacteristic(device, ScryptedInterface.Fan, fanService, Characteristic.TargetFanState,
                    () => device.fan?.mode === FanMode.Manual
                        ? Characteristic.TargetFanState.MANUAL
                        : Characteristic.TargetFanState.AUTO);
                fanService.getCharacteristic(Characteristic.TargetFanState).on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    device.setFan({
                        mode: value === Characteristic.TargetFanState.MANUAL ? FanMode.Manual : FanMode.Auto,
                    });
                });

                bindCharacteristic(device, ScryptedInterface.Fan, fanService, Characteristic.CurrentFanState,
                    () => !device.fan?.active
                        ? Characteristic.CurrentFanState.INACTIVE
                        : !device.fan.speed
                            ? Characteristic.CurrentFanState.IDLE
                            : Characteristic.CurrentFanState.BLOWING_AIR);
            }
        }
        else if (device.interfaces.includes(ScryptedInterface.OnOff)) {
            const fanService = accessory.addService(Service.Fan);
            bindCharacteristic(device, ScryptedInterface.OnOff, fanService, Characteristic.On,
                () => !!device.on);

            fanService.getCharacteristic(Characteristic.On).on(CharacteristicEventTypes.SET, (value, callback) => {
                callback();
                if (value)
                    device.turnOn();
                else
                    device.turnOff();
            });
        }

        return accessory;
    },
});
