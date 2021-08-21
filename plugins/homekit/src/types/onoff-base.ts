
import { OnOff, ScryptedDevice, ScryptedInterface } from '@scrypted/sdk'
import { uuid, Accessory, Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service, NodeCallback } from '../hap';
import { DummyDevice, listenCharacteristic } from '../common';
import { makeAccessory } from './common';

export function probe(device: DummyDevice): boolean {
    return device.interfaces.includes(ScryptedInterface.OnOff);
}

export function getAccessory(device: ScryptedDevice & OnOff, serviceType: any): { accessory: Accessory, service: Service } | undefined {
    const accessory = makeAccessory(device);

    const service = accessory.addService(serviceType, device.name);
    service.getCharacteristic(Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            if (value)
                device.turnOn();
            else
                device.turnOff();
        })
        .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
            callback(null, !!device.on);
        });

        listenCharacteristic(device, ScryptedInterface.OnOff, service, Characteristic.On);

    return {
        accessory,
        service,
    };
}
