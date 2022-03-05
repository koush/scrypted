import { Entry, EntrySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice, HomeKitSession } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Garage,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.Entry) && device.interfaces.includes(ScryptedInterface.EntrySensor);
    },
    getAccessory: async (device: ScryptedDevice & Entry & EntrySensor, homekitSession: HomeKitSession) => {
        const accessory = makeAccessory(device, homekitSession);

        const service = accessory.addService(Service.GarageDoorOpener, device.name);

        bindCharacteristic(device, ScryptedInterface.EntrySensor, service, Characteristic.CurrentDoorState,
            () => !!device.entryOpen ? Characteristic.CurrentDoorState.OPEN : Characteristic.CurrentDoorState.CLOSED);

        let targetState = !!device.entryOpen ? Characteristic.CurrentDoorState.OPEN : Characteristic.CurrentDoorState.CLOSED;
        service.getCharacteristic(Characteristic.TargetDoorState)
        .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
            callback(null, targetState);
        })
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            if (value === Characteristic.TargetDoorState.OPEN) {
                targetState = Characteristic.TargetDoorState.OPEN;
                device.openEntry();
            }
            else {
                targetState = Characteristic.TargetDoorState.CLOSED;
                device.closeEntry();
            }
        })

        return accessory;
    }
});
