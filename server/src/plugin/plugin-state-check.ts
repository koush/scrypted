import { ScryptedInterface, ScryptedInterfaceProperty } from "@scrypted/types";
import { propertyInterfaces } from "./descriptor";

export function checkProperty(key: string, value: any) {
    if (key === ScryptedInterfaceProperty.id)
        throw new Error("id is read only");
    if (key === ScryptedInterfaceProperty.mixins)
        throw new Error("mixins is read only");
    if (key === ScryptedInterfaceProperty.interfaces)
        throw new Error("interfaces is a read only post-mixin computed property, use providedInterfaces");
    const iface = propertyInterfaces[key.toString()];
    if (iface === ScryptedInterface.ScryptedDevice)
        throw new Error(`${key.toString()} can not be set. Use DeviceManager.onDevicesChanges or DeviceManager.onDeviceDiscovered to update the device description.`);
}
