import { Accessory, Characteristic, Service } from './hap';

import { ScryptedDevice } from "@scrypted/sdk";

export function addAccessoryDeviceInfo(device: ScryptedDevice, accessory: Accessory) {
    const deviceInfo = device.info;
    const info = accessory.getService(Service.AccessoryInformation)!;
    if (deviceInfo?.manufacturer)
        info.updateCharacteristic(Characteristic.Manufacturer, deviceInfo.manufacturer);
    if (deviceInfo?.model)
        info.updateCharacteristic(Characteristic.Model, deviceInfo.model);
    if (deviceInfo?.serialNumber)
        info.updateCharacteristic(Characteristic.SerialNumber, deviceInfo.serialNumber);
    if (deviceInfo?.firmware)
        info.updateCharacteristic(Characteristic.FirmwareRevision, deviceInfo.firmware);
    if (deviceInfo?.version)
        info.updateCharacteristic(Characteristic.HardwareRevision, deviceInfo.version);
}
