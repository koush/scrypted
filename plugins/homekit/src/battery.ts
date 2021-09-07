import { Battery, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { Accessory, Characteristic } from "../HAP-NodeJS/src";
import { Battery as HAPBattery, BatteryLevel, StatusLowBattery } from "../HAP-NodeJS/src/lib/definitions";
import { bindCharacteristic } from "./common";

export function maybeAddBatteryService(device: ScryptedDevice & Battery, accessory: Accessory) {
    if (!device.interfaces.includes(ScryptedInterface.Battery))
        return;

    const battery = new HAPBattery();
    bindCharacteristic(device, ScryptedInterface.Battery, battery, BatteryLevel, () => {
        battery.updateCharacteristic(Characteristic.StatusLowBattery, device.batteryLevel >= 20 ? StatusLowBattery.BATTERY_LEVEL_NORMAL : StatusLowBattery.BATTERY_LEVEL_LOW);
        return device.batteryLevel || 0;
    });

    accessory.addService(battery);
}
