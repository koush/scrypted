import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface, TemperatureSetting, Thermometer, ThermostatMode } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

function toGoogleMode(mode: ThermostatMode): string {
    switch (mode) {
        case ThermostatMode.Off: return "off"
        case ThermostatMode.Cool: return "cool"
        case ThermostatMode.Heat: return "heat"
        case ThermostatMode.HeatCool: return "heatcool"
        case ThermostatMode.Auto: return "auto"
        case ThermostatMode.FanOnly: return "fan-only"
        case ThermostatMode.Purifier: return "purifier"
        case ThermostatMode.Eco: return "eco"
        case ThermostatMode.Dry: return "dry"
        case ThermostatMode.On: return "on"
    }
}

addSupportedType({
    type: ScryptedDeviceType.Thermostat,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.TemperatureSetting) && device.interfaces.includes(ScryptedInterface.Thermometer);
    },
    async getSyncResponse(device: ScryptedDevice & TemperatureSetting & Thermometer) {
        const ret = syncResponse(device, 'action.devices.types.THERMOSTAT');
        ret.traits.push('action.devices.traits.TemperatureSetting');

        const availableModes = device.thermostatAvailableModes.map(mode => toGoogleMode(mode)).filter(mode => !!mode);

        ret.attributes.availableThermostatModes = availableModes;

        ret.attributes.thermostatTemperatureRange = {
            minThresholdCelsius: 10,
            maxThresholdCelsius: 40
        };

        ret.attributes.thermostatTemperatureUnit = device.temperatureUnit;

        return ret;
    },
    async query(device: ScryptedDevice & Thermometer & TemperatureSetting) {
        const ret = queryResponse(device);

        ret.thermostatMode = toGoogleMode(device.thermostatMode);
        ret.thermostatTemperatureAmbient = device.temperature || 22.22;
        ret.thermostatTemperatureSetpoint = device.thermostatSetpoint || device.temperature;
        ret.thermostatTemperatureSetpointHigh = device.thermostatSetpointHigh || device.temperature;
        ret.thermostatTemperatureSetpointLow = device.thermostatSetpointLow || device.temperature;

        return ret;
    },
})
