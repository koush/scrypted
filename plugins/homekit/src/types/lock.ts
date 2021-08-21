
import { Lock, LockState, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, DummyDevice } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Lock,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.Lock);
    },
    getAccessory: (device: ScryptedDevice & Lock) => {
        const accessory = makeAccessory(device);
        const service = accessory.addService(Service.LockMechanism, device.name);

        function toCurrentState(lockState: LockState) {
            switch (lockState) {
                case LockState.Locked:
                    return Characteristic.LockCurrentState.SECURED;
                case LockState.Jammed:
                    return Characteristic.LockCurrentState.JAMMED;
                default:
                    return Characteristic.LockCurrentState.UNSECURED;
            }
        }

        function toTargetState(lockState: LockState) {
            switch (lockState) {
                case LockState.Locked:
                    return Characteristic.LockTargetState.SECURED;
                default:
                    return Characteristic.LockTargetState.UNSECURED;
            }
        }

        service.getCharacteristic(Characteristic.LockCurrentState)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, toCurrentState(device.lockState));
            });


        let targetState = toTargetState(device.lockState);

        service.getCharacteristic(Characteristic.LockTargetState)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, targetState);
            })
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                targetState = value as number;
                callback();
                switch (targetState) {
                    case Characteristic.LockTargetState.UNSECURED:
                        device.unlock();
                        break;
                    default:
                        device.lock();
                        break;
                }
            })


        device.listen({
            event: ScryptedInterface.Lock,
            watch: true,
        }, (source, details, data) => {
            targetState = toTargetState(data);
            service.updateCharacteristic(Characteristic.LockTargetState, targetState);
            service.updateCharacteristic(Characteristic.LockCurrentState, toCurrentState(data));
        });

        return accessory;
    }
});
