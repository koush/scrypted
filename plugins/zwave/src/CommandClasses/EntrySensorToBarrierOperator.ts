import { EntrySensor } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { BarrierState } from "zwave-js";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class EntrySensorToBarriorOperator extends ZwaveDeviceBase implements EntrySensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        let currentValue: BarrierState
        currentValue = zwaveDevice.getValue(valueId);

        switch (currentValue) {
            case BarrierState.Closed:
                zwaveDevice.entryOpen = false;
                break;
            case BarrierState.Closing:
            case BarrierState.Opening:
            case BarrierState.Open:
            case BarrierState.Stopped:
                zwaveDevice.entryOpen = true;
                break;
            default:
                zwaveDevice.entryOpen = false;
        }
    }
}

export default EntrySensorToBarriorOperator;
