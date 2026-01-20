import { EventDetails, ScryptedDeviceAccessControl, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedUserAccessControl } from ".";

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

export class AccessControls {
    constructor(public acl: ScryptedUserAccessControl) {
    }

    deny(reason: string = 'User does not have permission') {
        throw new Error(reason);
    }

    shouldRejectDevice(id: string) {
        if (this.acl.devicesAccessControls === null)
            return false;

        if (!this.acl.devicesAccessControls)
            return true;

        const dacls = this.acl.devicesAccessControls.filter(dacl => dacl.id === id);
        return !dacls.length;
    }

    shouldRejectProperty(id: string, property: string) {
        if (this.acl.devicesAccessControls === null)
            return false;

        if (!this.acl.devicesAccessControls)
            return true;

        const dacls = this.acl.devicesAccessControls.filter(dacl => dacl.id === id);

        for (const dacl of dacls) {
            if (!dacl.properties || dacl.properties.includes(property))
                return false;
        }

        return true;
    }

    shouldRejectEvent(id: string, eventDetails: EventDetails) {
        if (this.acl.devicesAccessControls === null)
            return false;

        if (!this.acl.devicesAccessControls)
            return true;

        const dacls = this.acl.devicesAccessControls.filter(dacl => dacl.id === id);

        const { property } = eventDetails;
        if (property) {
            for (const dacl of dacls) {
                if (!dacl.properties || dacl.properties.includes(property))
                    return false;
            }
        }

        const { eventInterface } = eventDetails;

        for (const dacl of dacls) {
            if (!dacl.interfaces || dacl.interfaces.includes(eventInterface!))
                return false;
        }

        return true;
    }

    shouldRejectInterface(id: string, scryptedInterface: ScryptedInterface) {
        if (this.acl.devicesAccessControls === null)
            return false;

        if (!this.acl.devicesAccessControls)
            return true;

        const dacls = this.acl.devicesAccessControls.filter(dacl => dacl.id === id);

        for (const dacl of dacls) {
            if (!dacl.interfaces || dacl.interfaces.includes(scryptedInterface))
                return false;
        }

        return true;
    }

    shouldRejectMethod(id: string, method: string) {
        if (this.acl.devicesAccessControls === null)
            return false;

        if (!this.acl.devicesAccessControls)
            return true;

        const dacls = this.acl.devicesAccessControls.filter(dacl => dacl.id === id);

        for (const dacl of dacls) {
            if (!dacl.methods || dacl.methods.includes(method))
                return false;
        }

        return true;
    }
}