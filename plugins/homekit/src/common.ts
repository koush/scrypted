
import { EventDetails, EventListenerRegister, Refresh, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { Accessory, Characteristic, CharacteristicEventTypes, Service, SnapshotRequest, WithUUID } from './hap';
import type { HomeKitPlugin } from "./main";

export interface DummyDevice {
    interfaces?: string[];
    type?: ScryptedDeviceType | string;
}

export interface SnapshotThrottle {
    (request: SnapshotRequest): Promise<Buffer>;
}

interface SupportedType {
    type: ScryptedDeviceType;
    probe(device: DummyDevice): boolean;
    getAccessory: (device: ScryptedDevice & any, homekitPlugin: HomeKitPlugin) => Promise<Accessory>;
}

export const supportedTypes: { [type: string]: SupportedType } = {};

export function addSupportedType(type: SupportedType) {
    supportedTypes[type.type] = type;
}

export function bindCharacteristic<T extends WithUUID<{new (): Characteristic}>>(device: ScryptedDevice, event: ScryptedInterface, service: Service, characteristic: T, map: (eventSource?: any, eventDetails?: EventDetails, eventData?: any) => any, refresh?: boolean): EventListenerRegister {
    service.updateCharacteristic(characteristic, map());

    service.getCharacteristic(characteristic).on(CharacteristicEventTypes.GET, callback => {
        try {
            if (device.interfaces.includes(ScryptedInterface.Refresh)) {
                // it's not possible to determine if this is user initiated.
                // homekit seems to aggressively call get...
                (device as ScryptedDevice & Refresh).refresh(event, false);
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
    }, (source, details, data) => service.updateCharacteristic(characteristic, map(source, details, data)));
}
