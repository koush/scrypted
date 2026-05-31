import { TamperSensor } from "@scrypted/sdk";
import { ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { Notification } from "./Notification";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";


export class TamperSensorToHomeSecurity extends Notification implements TamperSensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs) {
        const notification = Notification.lookupNotification(zwaveDevice, 'Home Security');
        const value  = notification.lookupValue(valueId.newValue as number);
        // unset with any noninstrusion value
        zwaveDevice.tampered = !!value;
    }
}
