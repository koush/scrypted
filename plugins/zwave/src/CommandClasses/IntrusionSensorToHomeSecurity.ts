import { IntrusionSensor } from "@scrypted/sdk";
import { ValueID } from "@zwave-js/core";
import { ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { Notification } from "./Notification";
import { containsAny, ZwaveDeviceBase } from "./ZwaveDeviceBase";


export class IntrusionSensorToHomeSecurity extends Notification implements IntrusionSensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs) {
        const notification = Notification.lookupNotification(zwaveDevice, 'Home Security');
        const value  = notification.lookupValue(valueId.newValue as number);
        // unset with any noninstrusion value
        zwaveDevice.intrusionDetected = !!value;
    }
}
