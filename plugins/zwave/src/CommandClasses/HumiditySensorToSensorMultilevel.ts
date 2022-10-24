import { HumiditySensor} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class HumidityToSensorMultilevel extends ZwaveDeviceBase implements HumiditySensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.humidity = zwaveDevice.getValue(valueId);
    }
}

export default HumidityToSensorMultilevel;
