import { ScryptedInterface, ScryptedInterfaceProperty } from "@scrypted/types";
import { ScryptedRuntime } from "../runtime";
import { getState } from "../state";
import Graph from 'node-dijkstra';

export function hasMixinCycle(scrypted: ScryptedRuntime, id: string, mixins?: string[]) {
    const pluginDevice = scrypted.findPluginDeviceById(id);
    if (!pluginDevice)
        return false;
    mixins = mixins || getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];

    if (!mixins.length)
        return false;

    if (mixins.includes(id))
        return true;

    // connect all devices to their mixin providers.
    const nodes: { [node: string]: { [edge: string]: number } } = {};
    for (const nodeId of Object.keys(scrypted.stateManager.getSystemState())) {
        const node = scrypted.findPluginDeviceById(nodeId);
        // const interfaces = getState(node, ScryptedInterfaceProperty.interfaces) || [];
        // if (!interfaces.includes(ScryptedInterface.MixinProvider))
        //     continue;
        const edges: { [edge: string]: number } = nodes[nodeId] = {};

        let nodeMixins: string[];

        // when finding the node that is being checked for cyclical mixins, skip it.
        if (id === nodeId)
            continue;

        nodeMixins = getState(node, ScryptedInterfaceProperty.mixins) || [];
        for (const nodeMixin of nodeMixins) {
            edges[nodeMixin] = 1;
        }
    }

    // remove anything that isn't a mixin provider itself.
    for (const nodeId of Object.keys(scrypted.stateManager.getSystemState())) {
        const node = scrypted.findPluginDeviceById(nodeId);
        const interfaces = getState(node, ScryptedInterfaceProperty.interfaces) || [];
        if (!interfaces.includes(ScryptedInterface.MixinProvider)) {
            delete nodes[nodeId];
        }
    }

    const graph = new Graph();
    for (const id of Object.keys(nodes)) {
        graph.addNode(id, nodes[id]);
    }

    // determine if any of the mixins have a path back to the original device.
    for (const mixinId of mixins) {
        const route = graph.path(mixinId, id) as Array<string>;
        if (route?.length)
            return true;
    }

    return false;
}
