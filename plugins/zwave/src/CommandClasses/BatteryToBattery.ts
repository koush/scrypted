import { Battery} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class BatteryToBattery extends ZwaveDeviceBase implements Battery {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.batteryLevel = zwaveDevice.getValue(valueId);
    }
}

export default BatteryToBattery;
