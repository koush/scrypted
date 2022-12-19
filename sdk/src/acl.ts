import { ScryptedInterfaceDescriptors, ScryptedInterface, ScryptedDeviceAccessControl } from ".";

export function addAccessControlsForInterface(id: string, ...scryptedInterfaces: ScryptedInterface[]): ScryptedDeviceAccessControl {
    const methods = scryptedInterfaces.map(scryptedInterface => ScryptedInterfaceDescriptors[scryptedInterface].methods).flat();
    const properties = scryptedInterfaces.map(scryptedInterface => ScryptedInterfaceDescriptors[scryptedInterface].properties).flat();
    const interfaces = scryptedInterfaces;
    return {
        id,
        methods,
        properties,
        interfaces,
    }
}
