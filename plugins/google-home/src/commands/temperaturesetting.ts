import { Entry, OnOff, ScryptedDevice, TemperatureSetting, ThermostatMode } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

commandHandlers['action.devices.commands.ThermostatTemperatureSetpoint'] = async (device: ScryptedDevice & TemperatureSetting, execution) => {
    const ret = executeResponse(device);
    device.setTemperature({
        setpoint: execution.params.thermostatTemperatureSetpoint,
    });
    return ret;
}

commandHandlers['action.devices.commands.ThermostatTemperatureSetRange'] = async (device: ScryptedDevice & TemperatureSetting, execution) => {
    const ret = executeResponse(device);
    device.setTemperature({
        setpoint: [
            execution.params.thermostatTemperatureSetpointLow,
            execution.params.thermostatTemperatureSetpointHigh,
        ]
    })
    return ret;
}

function fromGoogleMode(mode: string): ThermostatMode {
    switch (mode) {
        case 'off': return ThermostatMode.Off;
        case 'heat': return ThermostatMode.Heat;
        case 'cool': return ThermostatMode.Cool;
        case 'on': return ThermostatMode.On;
        case 'heatcool': return ThermostatMode.HeatCool;
        case 'auto': return ThermostatMode.Auto;
        case 'fan-only': return ThermostatMode.FanOnly;
        case 'purifier': return ThermostatMode.Purifier;
        case 'eco': return ThermostatMode.Eco;
        case 'dry': return ThermostatMode.Dry;
    }
}

commandHandlers['action.devices.commands.ThermostatSetMode'] = async (device: ScryptedDevice & TemperatureSetting, execution) => {
    const ret = executeResponse(device);
    device.setTemperature({
        mode: fromGoogleMode(execution.params.thermostatMode),
    });
    return ret;
}
