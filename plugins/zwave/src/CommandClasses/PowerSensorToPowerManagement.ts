import { PowerSensor } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZWaveNode, ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { Notification } from "./Notification";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

const powerApplied = 'Power has been applied';

export class PowerSensorToPowerManagement extends Notification implements PowerSensor {
  static powerStates = [
    powerApplied,
  ];

  static getInterfaces(node: ZWaveNode, valueId: ValueID): string[] {
    if (Notification.checkInterface(node, valueId, powerApplied)) {
      return ['PowerSensor'];
    }
    return null;
  }

  static onValueChanged(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs) {
    if (valueId.propertyKey === 'Power status') {
      const notification = Notification.lookupNotification(zwaveDevice, 'Power Management');
      zwaveDevice.powerDetected = notification.lookupValue(valueId.newValue as number)?.label === 'Power has been applied';
    }
  }
}
