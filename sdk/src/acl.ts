import { ScryptedDeviceAccessControl, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedUserAccessControl } from ".";

export function addAccessControlsForInterface(id: string, ...scryptedInterfaces: ScryptedInterface[]): ScryptedDeviceAccessControl {
    const methods = scryptedInterfaces.map(scryptedInterface => ScryptedInterfaceDescriptors[scryptedInterface]?.methods || []).flat();
    const properties = scryptedInterfaces.map(scryptedInterface => ScryptedInterfaceDescriptors[scryptedInterface]?.properties || []).flat();
    const interfaces = scryptedInterfaces;
    return {
        id,
        methods,
        properties,
        interfaces,
    }
}

export function mergeDeviceAccessControls(accessControls: ScryptedUserAccessControl, dacls: ScryptedDeviceAccessControl[]) {
    if (!accessControls || accessControls.devicesAccessControls === null)
        return accessControls;

    accessControls.devicesAccessControls ||= [];
    accessControls.devicesAccessControls.push(...dacls);
    return accessControls;
}
