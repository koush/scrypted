
import { EventListenerRegister, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { Accessory, Service, SnapshotRequest } from './hap';

export interface DummyDevice {
    interfaces?: string[];
    type?: ScryptedDeviceType;
}

export interface SnapshotThrottle {
    (request: SnapshotRequest): Promise<Buffer>;
}

export interface HomeKitSession {
    snapshotThrottles: Map<string, SnapshotThrottle>;
}

interface SupportedType {
    type: ScryptedDeviceType;
    probe(device: DummyDevice): boolean;
    getAccessory: (device: ScryptedDevice & any, homekitSession: HomeKitSession) => Promise<Accessory>;
    noBridge?: boolean;
}

export const supportedTypes: { [type: string]: SupportedType } = {};

export function addSupportedType(type: SupportedType) {
    supportedTypes[type.type] = type;
}

export function bindCharacteristic(device: ScryptedDevice, event: ScryptedInterface, service: Service, characteristic: any, map: () => any, refresh?: boolean): EventListenerRegister {
    service.updateCharacteristic(characteristic, map());

    return device.listen({
        event,
        watch: !refresh,
    }, () =>  service.updateCharacteristic(characteristic, map()));
}
