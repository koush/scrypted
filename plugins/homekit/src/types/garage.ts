
import { Entry, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, StartStop } from '@scrypted/sdk'
import { addSupportedType, DummyDevice, listenCharacteristic } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Garage,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.Entry);
    },
    getAccessory: (device: ScryptedDevice & Entry) => {
        const accessory = makeAccessory(device);

        const service = accessory.addService(Service.GarageDoorOpener, device.name);
        service.getCharacteristic(Characteristic.CurrentDoorState)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, !!device.entryOpen ? Characteristic.CurrentDoorState.OPEN : Characteristic.CurrentDoorState.CLOSED);
            });


        device.listen({
            event: ScryptedInterface.Entry,
        }, (eventSource, eventDetails, data) => {
            service.updateCharacteristic(Characteristic.CurrentDoorState, 
                !!device.entryOpen ? Characteristic.CurrentDoorState.OPEN : Characteristic.CurrentDoorState.CLOSED);
        })

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
