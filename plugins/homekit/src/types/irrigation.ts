
import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface, StartStop } from '@scrypted/sdk'
import { addSupportedType, DummyDevice, listenCharacteristic } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Irrigation,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.StartStop);
    },
    getAccessory: (device: ScryptedDevice & StartStop) => {
        const accessory = makeAccessory(device);

        const service = accessory.addService(Service.Valve, device.name);
        service.getCharacteristic(Characteristic.Active)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                if (value)
                    device.start();
                else
                    device.stop();
            })
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, !!device.running ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
            });

        listenCharacteristic(device, ScryptedInterface.StartStop, service, Characteristic.Active);
        listenCharacteristic(device, ScryptedInterface.StartStop, service, Characteristic.InUse);

        service.getCharacteristic(Characteristic.InUse)
        .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
            callback(null, !!device.running ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
        });

        service.getCharacteristic(Characteristic.RemainingDuration)
        .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
            callback(null, 1800);
        });

        return accessory;
    }
});
