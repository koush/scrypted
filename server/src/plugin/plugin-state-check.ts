import { ScryptedInterface, ScryptedInterfaceProperty } from "@scrypted/types";
import { RpcPeer } from "../rpc";
import { propertyInterfaces } from "./descriptor";

export function checkProperty(key: string, value: any) {
    if (key === ScryptedInterfaceProperty.id)
        throw new Error("id is read only");
    if (key === ScryptedInterfaceProperty.nativeId)
        throw new Error("nativeId is read only");
    if (key === ScryptedInterfaceProperty.mixins)
        throw new Error("mixins is read only");
    if (key === ScryptedInterfaceProperty.interfaces)
        throw new Error("interfaces is a read only post-mixin computed property, use providedInterfaces");
    if (RpcPeer.isRpcProxy(value))
        throw new Error('value must be a primitive type')
    const iface = propertyInterfaces[key.toString()];
    if (iface === ScryptedInterface.ScryptedDevice) {
        // only allow info to be set, since that doesn't actually change the descriptor
        // or the provided* properties (room, interfaces, name, type).
        if (key !== ScryptedInterfaceProperty.info)
            throw new Error(`${key.toString()} can not be set. Use DeviceManager.onDevicesChanges or DeviceManager.onDeviceDiscovered to update the device description.`);
    }
}
