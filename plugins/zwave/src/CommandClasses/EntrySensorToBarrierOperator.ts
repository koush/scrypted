import { EntrySensor } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class EntrySensorToBarriorOperator extends ZwaveDeviceBase implements EntrySensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        let currentValue: number;
        currentValue = zwaveDevice.getValue(valueId);

        switch (currentValue) {
            case 0:
                zwaveDevice.entryOpen = false;
                break;
            case 100:
                zwaveDevice.entryOpen = true;
                break;
        }
    }
}

export default EntrySensorToBarriorOperator;
