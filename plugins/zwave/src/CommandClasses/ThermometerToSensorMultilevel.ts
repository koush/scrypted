import {Thermometer, TemperatureUnit} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class ThermometerToSensorMultilevel extends ZwaveDeviceBase implements Thermometer {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        var f = zwaveDevice.getValueUnit(valueId) === TemperatureUnit.F;
        if (!f) {
            zwaveDevice.temperature = zwaveDevice.getValue(valueId);
            zwaveDevice.temperatureUnit = TemperatureUnit.C;
        }
        else {
            zwaveDevice.temperature = (zwaveDevice.getValue(valueId) as number - 32) * 5 / 9;
            zwaveDevice.temperatureUnit = TemperatureUnit.F;
        }
    }
    
    async setTemperatureUnit(temperatureUnit: TemperatureUnit): Promise<void> {
        
    }
}

export default ThermometerToSensorMultilevel;
