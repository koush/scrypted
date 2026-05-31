import { Endpoint, ZWaveController, ZWaveNode } from "zwave-js";
import { ZwaveDeviceBase } from "./CommandClasses/ZwaveDeviceBase";

export function getInstanceHash(homeId: number, nodeId: number, instance: number): string {
    return `${homeId}#${nodeId}#${instance}`;
}

export function getHash(controller: ZWaveController, endpoint: Endpoint): string {
    return getInstanceHash(controller.homeId, endpoint.getNodeUnsafe().id, endpoint.index);
}

export function getNodeHash(controller: ZWaveController, node: ZWaveNode): string {
    return `${controller.homeId}#${node.id}`;
}
