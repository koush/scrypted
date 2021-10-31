
import { HumiditySensor, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode } from '@scrypted/sdk'
import { access } from 'fs';
import { Fanv2 } from 'hap-nodejs/dist/lib/definitions';
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Thermostat,
    probe(device: DummyDevice) {
        if (!device.interfaces.includes(ScryptedInterface.TemperatureSetting) || !device.interfaces.includes(ScryptedInterface.Thermometer))
            return false;
        return true;
    },
    getAccessory: async (device: ScryptedDevice & TemperatureSetting & Thermometer & HumiditySensor & OnOff) => {
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
            () => toTargetMode(device.thermostatActiveMode));

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

        if (device.interfaces.includes(ScryptedInterface.OnOff)) {
            const fanService = accessory.addService(Fanv2);
            bindCharacteristic(device, ScryptedInterface.OnOff, fanService, Characteristic.Active,
                () => device.on ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
        }

        return accessory;
    }
});
