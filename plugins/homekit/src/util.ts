import sdk, { OnOff, ScryptedDeviceBase, ScryptedInterface } from '@scrypted/sdk';

/*
 * flattenDeviceTree performs a modified DFS tree traversal of the given
 * device mapping to produce a list of device ids. deviceId is the node
 * of the tree currently being processed, where null is the root of the
 * tree.
 */
function flattenDeviceTree(deviceMap: Map<string, string[]>, deviceId: string): string[] {
    const result: string[] = [];
    if (!deviceMap.has(deviceId)) // no children
        return result;

    const children = deviceMap.get(deviceId);
    result.push(...children);
    children.map(child =>  result.push(...flattenDeviceTree(deviceMap, child)))
    return result;
}

/*
 * reorderDevicesByProvider returns a new ordering of the provided deviceIds
 * where it is guaranteed that DeviceProviders are listed before their children.
 */
export function reorderDevicesByProvider(deviceIds: string[]): string[] {
    const { systemManager } = sdk;
    const deviceIdSet = new Set(deviceIds);
    const providerDeviceIdMap = new Map<string, string[]>();

    deviceIds.map(deviceId => {
        const device = systemManager.getDeviceById(deviceId);

        // only use the provider id as a parent key when it refers to another
        // device that is present in the system state. a missing or self
        // referential provider means the device is a root. this also ensures
        // orphaned devices (providerId pointing at a removed device) are not
        // dropped from the ordering.
        const providerId = device.providerId
            && device.providerId !== device.id
            && deviceIdSet.has(device.providerId)
            ? device.providerId
            : null;
        if (providerDeviceIdMap.has(providerId)) {
            providerDeviceIdMap.get(providerId).push(device.id);
        } else {
            providerDeviceIdMap.set(providerId, [device.id]);
        }
    });

    return flattenDeviceTree(providerDeviceIdMap, null);
}

class TestDeviceBase {

}

function hideProps<T>():  new()=> T {
    return TestDeviceBase as any;
}

class Poop extends hideProps<TestDeviceBase & OnOff>() {
    constructor() {
        super();
    }
}