import { Battery, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { bindCharacteristic } from "./common";
import { Accessory, Battery as HAPBattery, Characteristic, StatusLowBattery } from "./hap";

export function maybeAddBatteryService(device: ScryptedDevice & Battery, accessory: Accessory) {
    if (!device.interfaces.includes(ScryptedInterface.Battery))
        return;

    const battery = new HAPBattery();
    bindCharacteristic(device, ScryptedInterface.Battery, battery, Characteristic.BatteryLevel, () => {
        return Math.min(Math.max(0, device.batteryLevel), 100) || 0;
    });

    bindCharacteristic(device, ScryptedInterface.Battery, battery, Characteristic.StatusLowBattery, () => {
        return device.batteryLevel >= 20 ? StatusLowBattery.BATTERY_LEVEL_NORMAL : StatusLowBattery.BATTERY_LEVEL_LOW;
    });

    accessory.addService(battery);
}
