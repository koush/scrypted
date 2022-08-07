import { AmbientLightSensor } from "@scrypted/sdk";
import { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class AmbientLightSensorToSensorMultilevel extends ZwaveDeviceBase implements AmbientLightSensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.ambientLight = zwaveDevice.getValue(valueId);
    }
}

export default AmbientLightSensorToSensorMultilevel;
