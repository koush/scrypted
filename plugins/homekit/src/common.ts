
import { EventListenerRegister, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { Accessory, Characteristic, Service } from './hap';

const { systemManager } = sdk;

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
