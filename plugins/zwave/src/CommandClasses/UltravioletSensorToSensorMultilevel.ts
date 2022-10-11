import {UltravioletSensor} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class UltravioletSensorMultilevel extends ZwaveDeviceBase implements UltravioletSensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.ultraviolet = zwaveDevice.getValue(valueId);
    }
}

export default UltravioletSensorMultilevel;
