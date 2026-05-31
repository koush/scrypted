import { CO2Sensor } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZWaveNode, ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { Notification } from "./Notification";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class SmokeAlarmToCO2Sensor extends Notification implements CO2Sensor {
  static getInterfaces(node: ZWaveNode, valueId: ValueID): string[] {
    if (Notification.checkInterface(node, valueId, 'Smoke detected')
      || Notification.checkInterface(node, valueId, 'Smoke detected (location provided)')) {
      return ['CO2Sensor'];
    }
    return null;
  }

  static onValueChanged(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs) {
    if (valueId.propertyKey === 'Alarm status') {
      const notification = Notification.lookupNotification(zwaveDevice, 'Smoke Alarm');
      zwaveDevice.co2ppm = notification.lookupValue(valueId.newValue as number) ? 50 : 0;
    }
  }
}
