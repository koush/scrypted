
import { EventListenerRegister, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { Accessory, Service } from './hap';

export interface DummyDevice {
    interfaces?: string[];
    type?: ScryptedDeviceType;
}

interface SupportedType {
    type: ScryptedDeviceType;
    probe(device: DummyDevice): boolean;
    getAccessory: (device: ScryptedDevice & any) => Accessory;
    noBridge?: boolean;
}

export const supportedTypes: { [type: string]: SupportedType } = {};

export function addSupportedType(type: SupportedType) {
    supportedTypes[type.type] = type;
}

export function listenCharacteristic(device: ScryptedDevice, event: ScryptedInterface, service: Service, characteristic: any, refresh?: boolean): EventListenerRegister {
    return device.listen({
        event,
        watch: !refresh,
    }, (eventSource, eventDetails, data) => {
        service.updateCharacteristic(characteristic, data);
    })
}

export function bindCharacteristic(device: ScryptedDevice, event: ScryptedInterface, service: Service, characteristic: any, map: () => any, refresh?: boolean): EventListenerRegister {
    service.updateCharacteristic(characteristic, map());

    return device.listen({
        event,
        watch: !refresh,
    }, () =>  service.updateCharacteristic(characteristic, map()));
}
