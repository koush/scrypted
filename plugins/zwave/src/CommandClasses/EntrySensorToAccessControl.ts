import { EntrySensor } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZWaveNode, ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { Notification } from "./Notification";
import { containsAny, ZwaveDeviceBase } from "./ZwaveDeviceBase";

const doorStates = ['Door state', 'Door handle state'];

export class EntrySensorToAccessControl extends Notification implements EntrySensor {
    static getInterfaces(node: ZWaveNode, valueId: ValueID): string[] {
        if (Notification.checkInterface(node, valueId, 'Window/door is open', 'Window/door is closed') ||
            Notification.checkInterface(node, valueId, 'Window/door handle is open', 'Window/door handle is closed')) {
            return ['EntrySensor'];
        }
        return null;
    }

    static onValueChanged(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs) {
        // schlage locks send notifications of lock change events, but does not change the actual lock command class value.
        // so force a refresh.
        if (containsAny(valueId.propertyKey as string, 'lock operation', 'unlock operation', 'locked operation', 'Lock jammed', 'invalid user code')) {
            zwaveDevice.log.i('Notifcation of lock state change, refreshing.');
            zwaveDevice.transientState.lockJammed = valueId.propertyKey === 'Lock jammed';
            // we ignore Refresh calls that are non user initiated, so this must be marked as such.
            zwaveDevice.refresh('Lock', true);
            return;
        }

        if (doorStates.includes(valueId.propertyKey as string)) {
            const notification = Notification.lookupNotification(zwaveDevice, 'Access Control');
            const event = notification.lookupValue(valueId.newValue as number);
            zwaveDevice.entryOpen = containsAny(event?.label, 'is open');
        }
    }
}
