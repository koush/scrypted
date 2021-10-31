
import { EventDetails, EventListener, EventListenerRegister, Refresh, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { CharacteristicEventTypes } from 'hap-nodejs';
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
    isHomeKitHub(ip: string): boolean;
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

export function bindCharacteristic(device: ScryptedDevice, event: ScryptedInterface, service: Service, characteristic: any, map: (eventSource?: any, eventDetails?: EventDetails, eventData?: any) => any, refresh?: boolean): EventListenerRegister {
    service.updateCharacteristic(characteristic, map());

    service.getCharacteristic(characteristic).on(CharacteristicEventTypes.GET, callback => {
        try {
            if (device.interfaces.includes(ScryptedInterface.Refresh)) {
                (device as ScryptedDevice & Refresh).refresh(event, true);
            }
            callback(null, map());
        }
        catch (e) {
            callback(e);
        }
    });

    return device.listen({
        event,
        watch: !refresh,
    }, (source, details, data) =>  service.updateCharacteristic(characteristic, map(source, details, data)));
}
