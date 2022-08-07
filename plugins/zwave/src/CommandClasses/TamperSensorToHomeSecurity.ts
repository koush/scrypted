import { ScryptedInterface, TamperSensor, MotionSensor } from "@scrypted/sdk";
import { ZWaveNode, ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { ValueID } from "@zwave-js/core";
import { Notification } from "./Notification";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";


export class TamperSensorToHomeSecurity extends Notification implements TamperSensor, MotionSensor {
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs) {
        const notification = Notification.lookupNotification(zwaveDevice, 'Home Security');
        const value  = notification.lookupValue(valueId.newValue as number);

        if (valueId.propertyKey === "Motion sensor status")
            zwaveDevice.motionDetected = !!value;
        else
            zwaveDevice.tampered = !!value;
    }

    static getInterfaces(node: ZWaveNode, valueId: ValueID): string[] {
        const interfaces = [ScryptedInterface.TamperSensor];
        if (Notification.checkInterface(node, valueId, "Motion detection")) {
            interfaces.push(ScryptedInterface.MotionSensor);
        }
        return interfaces;
    }
}
