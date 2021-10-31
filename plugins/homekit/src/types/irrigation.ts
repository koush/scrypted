
import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface, StartStop } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Irrigation,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.StartStop);
    },
    getAccessory: async (device: ScryptedDevice & StartStop) => {
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

        bindCharacteristic(device, ScryptedInterface.StartStop, service, Characteristic.Active,
            () => !!device.running ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
        bindCharacteristic(device, ScryptedInterface.StartStop, service, Characteristic.InUse,
            () => !!device.running ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);

        // todo: fix this.
        service.updateCharacteristic(Characteristic.RemainingDuration, 1800)

        return accessory;
    }
});
