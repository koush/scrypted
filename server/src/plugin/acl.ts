import type { EventDetails, ScryptedInterface, ScryptedUserAccessControl } from "@scrypted/types";

/**
 * Scrypted Access Controls allow selective reading of state, subscription to evemts,
 * and invocation of methods.
 * Everything else should be rejected.
 */
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
            if (!dacl.interfaces || dacl.interfaces.includes(eventInterface))
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