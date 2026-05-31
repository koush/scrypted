import sdk from "@scrypted/sdk";
import { ValueID, ValueMetadataNumeric } from "@zwave-js/core";
import { ZWaveNode } from "zwave-js";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";
import { Notification as ZWaveNotification } from '@zwave-js/config';

export enum NotificationType
{
    WaterAlarm = 5,
    AccessControl = 6,
    HomeSecurity = 7,
    PowerManagement = 8,
}

export class Notification extends ZwaveDeviceBase {
    static lookupNotification(zwaveDevice: ZwaveDeviceBase, name: string): ZWaveNotification {
        const {configManager} = zwaveDevice.zwaveController.driver;
        const notifications: Map<number, ZWaveNotification> = (configManager as any).notifications;
        for (const n of notifications.values()) {
            if (n.name === name)
                return n;
        }
    }

    static checkInterface(node: ZWaveNode, valueId: ValueID, ...enums: string[]): boolean {
        const metadata = node.getValueMetadata(valueId);
        const states = Object.values((metadata as ValueMetadataNumeric).states || {});
        for (const e of enums) {
            if (!states.includes(e))
                return false;
        }
        return true;
    }
}
