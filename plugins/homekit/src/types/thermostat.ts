
import { HumiditySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode } from '@scrypted/sdk'
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
    getAccessory: async (device: ScryptedDevice & TemperatureSetting & Thermometer & HumiditySensor) => {
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

        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, toCurrentMode(device.thermostatActiveMode));
            });


        service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, toTargetMode(device.thermostatMode));
            })
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setThermostatMode(fromTargetMode(value as number));
            })


        function getTargetTemperature() {
            return device.thermostatSetpoint ||
                ((device.thermostatSetpointHigh + device.thermostatSetpointLow) / 2) ||
                device.temperature;
        }

        service.getCharacteristic(Characteristic.TargetTemperature)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, getTargetTemperature());
            })
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                device.setThermostatSetpoint(value as number);
            })

        service.setCharacteristic(Characteristic.TemperatureDisplayUnits,
            device.temperatureUnit === TemperatureUnit.C ? Characteristic.TemperatureDisplayUnits.CELSIUS : Characteristic.TemperatureDisplayUnits.FAHRENHEIT);

        device.listen({
            event: ScryptedInterface.TemperatureSetting,
            watch: true,
        }, (source, details, data) => {
            service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, toTargetMode(device.thermostatMode));
            service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, toCurrentMode(device.thermostatActiveMode));
            service.updateCharacteristic(Characteristic.TargetTemperature, getTargetTemperature());
            service.updateCharacteristic(Characteristic.TemperatureDisplayUnits, device.temperatureUnit === TemperatureUnit.C ? Characteristic.TemperatureDisplayUnits.CELSIUS : Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
        });

        bindCharacteristic(device, ScryptedInterface.Thermometer, service, Characteristic.CurrentTemperature,
            () => device.temperature || 0);

        if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
            bindCharacteristic(device, ScryptedInterface.HumiditySensor, service, Characteristic.CurrentRelativeHumidity,
                () => device.humidity || 0);
        }

        return accessory;
    }
});
