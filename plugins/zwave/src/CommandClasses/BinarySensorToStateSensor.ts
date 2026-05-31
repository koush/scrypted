import {BinarySensor} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class BinarySensorToStateSensor extends ZwaveDeviceBase implements BinarySensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.binaryState = zwaveDevice.getValue(valueId);
    }
}

export default BinarySensorToStateSensor;
