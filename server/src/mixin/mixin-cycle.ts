import { ScryptedInterfaceProperty } from "@scrypted/types";
import { ScryptedRuntime } from "../runtime";
import { getState } from "../state";

export function getMixins(scrypted: ScryptedRuntime, id: string) {
    const pluginDevice = scrypted.findPluginDeviceById(id);
    if (!pluginDevice)
        return [];
    return getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
}

export function hasMixinCycle(scrypted: ScryptedRuntime, id: string, mixins?: string[]) {
    mixins = mixins || getMixins(scrypted, id);

    // given the mixins for a device, find all the mixins for those mixins,
    // and create a visited graph.
    // if the visited graphs includes the original device, that indicates
    // a cyclical dependency for that device.
    const visitedMixins = new Set(mixins);

    mixins = mixins.slice();
    while (mixins.length) {
        const mixin = mixins.pop();
        if (visitedMixins.has(mixin))
            continue;
        visitedMixins.add(mixin);
        const providerMixins = getMixins(scrypted, mixin);
        mixins.push(...providerMixins);
    }

    return visitedMixins.has(id);
}
