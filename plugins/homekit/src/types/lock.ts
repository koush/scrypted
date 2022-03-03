
import { Lock, LockState, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice, HomeKitSession } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Lock,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.Lock);
    },
    getAccessory: async (device: ScryptedDevice & Lock, homekitSession: HomeKitSession) => {
        const accessory = makeAccessory(device, homekitSession);
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

        let targetState = toTargetState(device.lockState);

        service.getCharacteristic(Characteristic.LockTargetState)
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
            });

        bindCharacteristic(device, ScryptedInterface.Lock, service, Characteristic.LockTargetState, () => {
            targetState = toTargetState(device.lockState);
            return targetState;
        })

        bindCharacteristic(device, ScryptedInterface.Lock, service, Characteristic.LockCurrentState,
            () => toCurrentState(device.lockState));

        return accessory;
    }
});
