import { Lock, LockState, ScryptedDevice, ScryptedInterface } from '@scrypted/sdk';
import { bindCharacteristic } from '../common';
import { Accessory, Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { setServiceName } from "../service-names";

/**
 * Adds a lock mechanism for the device to the accessory. A subtype is required when
 * the lock is merged into another device's accessory, and names the service there.
 */
export function getService(device: ScryptedDevice & Lock, accessory: Accessory, subtype?: string): Service {
    const service = accessory.addService(Service.LockMechanism, device.name, subtype);
    if (subtype)
        setServiceName(service, device.name);

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

    return service;
}
