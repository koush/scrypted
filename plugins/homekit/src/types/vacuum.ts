
import { Dock, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, StartStop } from '@scrypted/sdk'
import { addSupportedType, DummyDevice, listenCharacteristic } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Vacuum,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.StartStop);
    },
    getAccessory: (device: ScryptedDevice & StartStop & Dock) => {
        const accessory = makeAccessory(device);

        const service = accessory.addService(Service.Outlet, device.name);
        service.getCharacteristic(Characteristic.On)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                if (value)
                    device.start();
                else if (device.interfaces.includes(ScryptedInterface.Dock))
                    device.dock();
                else
                    device.stop();
            })
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, !!device.running);
            });

        listenCharacteristic(device, ScryptedInterface.StartStop, service, Characteristic.On);

        return accessory;
    }
});
