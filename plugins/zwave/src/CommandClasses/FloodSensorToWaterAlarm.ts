import { FloodSensor } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZWaveNode, ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { Notification } from "./Notification";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class FloodSensorToWaterAlarm extends Notification implements FloodSensor {
  static getInterfaces(node: ZWaveNode, valueId: ValueID): string[] {
    if (Notification.checkInterface(node, valueId, 'Water leak detected')
      || Notification.checkInterface(node, valueId, 'Water leak detected (location provided)')) {
      return ['FloodSensor'];
    }
    return null;
  }

  static onValueChanged(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs) {
    if (valueId.propertyKey === 'Sensor status') {
      const notification = Notification.lookupNotification(zwaveDevice, 'Water Alarm');
      // any non idle value works?
      zwaveDevice.flooded = !!notification.lookupValue(valueId.newValue as number);
    }
  }
}
