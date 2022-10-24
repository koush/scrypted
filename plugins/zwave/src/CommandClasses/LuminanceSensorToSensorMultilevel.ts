import { LuminanceSensor} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class LuminanceSensorToSensorMultilevel extends ZwaveDeviceBase implements LuminanceSensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.luminance = zwaveDevice.getValue(valueId);
    }
}

export default LuminanceSensorToSensorMultilevel;
