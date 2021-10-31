import { Battery, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { Accessory, Characteristic } from "hap-nodejs";
import { Battery as HAPBattery, BatteryLevel, StatusLowBattery } from "hap-nodejs/dist/lib/definitions";
import { bindCharacteristic } from "./common";

export function maybeAddBatteryService(device: ScryptedDevice & Battery, accessory: Accessory) {
    if (!device.interfaces.includes(ScryptedInterface.Battery))
        return;

    const battery = new HAPBattery();
    bindCharacteristic(device, ScryptedInterface.Battery, battery, Characteristic.BatteryLevel, () => {
        return device.batteryLevel || 0;
    });

    bindCharacteristic(device, ScryptedInterface.Battery, battery, Characteristic.StatusLowBattery, () => {
        return device.batteryLevel >= 20 ? StatusLowBattery.BATTERY_LEVEL_NORMAL : StatusLowBattery.BATTERY_LEVEL_LOW;
    });

    accessory.addService(battery);
}
