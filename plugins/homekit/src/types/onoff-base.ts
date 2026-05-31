import { OnOff, ScryptedDevice, ScryptedInterface } from '@scrypted/sdk';
import { bindCharacteristic, DummyDevice,  } from '../common';
import { Accessory, Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";

export function probe(device: DummyDevice): boolean {
    return device.interfaces.includes(ScryptedInterface.OnOff);
}

export function getService(device: ScryptedDevice & OnOff, accessory: Accessory, serviceType: any): Service {
    const service = accessory.addService(serviceType, device.name, device.nativeId);
    service.getCharacteristic(Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            if (value)
                device.turnOn();
            else
                device.turnOff();
        })

    bindCharacteristic(device, ScryptedInterface.OnOff, service, Characteristic.On, () => !!device.on);
    return service;
}

export function getAccessory(device: ScryptedDevice & OnOff, homekitPlugin: HomeKitPlugin, serviceType: any): { accessory: Accessory, service: Service } | undefined {
    const accessory = makeAccessory(device, homekitPlugin);
    const service = getService(device, accessory, serviceType);
    return {
        accessory,
        service,
    };
}
