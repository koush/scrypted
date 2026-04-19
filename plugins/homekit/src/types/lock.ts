import sdk, { DeviceProvider, Lock, LockState, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice, } from '../common';
import { Accessory, Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { getChildDevices, makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";
import { HOMEKIT_MIXIN } from '../homekit-mixin';

export function addLock(device: ScryptedDevice & Lock, accessory: Accessory): Service {
    if (!device.interfaces.includes(ScryptedInterface.Lock))
        return undefined;

    const service = accessory.addService(Service.LockMechanism, device.name);

    let autoLockTimeout: any;
    let isUnlocking = false;

    function getAutoLockDelay() {
        try {
            const mixinStorage = sdk.deviceManager.getMixinStorage(device.id, undefined);
            const delayStr = mixinStorage?.getItem('lockAutoLockDelay');
            const delay = parseInt(delayStr as any) || 0;
            console.log(`[${device.name}] Storage delay string: "${delayStr}", Parsed: ${delay}`);
            return delay;
        } catch (e) {
            return 0;
        }
    }

    function toCurrentState(lockState: LockState) {
        if (isUnlocking) {
            return Characteristic.LockCurrentState.UNSECURED;
        }
        if (getAutoLockDelay() > 0) {
            return Characteristic.LockCurrentState.SECURED;
        }

        switch (lockState) {
            case LockState.Unlocked:
                return Characteristic.LockCurrentState.UNSECURED;
            case LockState.Jammed:
                return Characteristic.LockCurrentState.JAMMED;
            case LockState.Locked:
            default:
                return Characteristic.LockCurrentState.SECURED;
        }
    }

    function toTargetState(lockState: LockState) {
        if (isUnlocking) {
            return Characteristic.LockTargetState.UNSECURED;
        }
        if (getAutoLockDelay() > 0) {
            return Characteristic.LockTargetState.SECURED;
        }

        switch (lockState) {
            case LockState.Unlocked:
                return Characteristic.LockTargetState.UNSECURED;
            case LockState.Locked:
            default:
                return Characteristic.LockTargetState.SECURED;
        }
    }

    let targetState = toTargetState(device.lockState);

    service.getCharacteristic(Characteristic.LockTargetState)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            targetState = value as number;
            
            clearTimeout(autoLockTimeout);
            autoLockTimeout = undefined;
            
            switch (targetState) {
                case Characteristic.LockTargetState.UNSECURED:
                    callback();
                    device.unlock();
                    
                    const autoLockDelay = getAutoLockDelay();
                    console.log(`[${device.name}] TargetState UNSECURED triggered. Evaluated Auto-Lock delay is: ${autoLockDelay}`);
                    
                    if (autoLockDelay > 0) {
                        isUnlocking = true;
                        console.log(`[${device.name}] Pushing immediate UNSECURED state to HomeKit...`);
                        service.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
                        
                        autoLockTimeout = setTimeout(() => {
                            isUnlocking = false;
                            autoLockTimeout = undefined;
                            service.updateCharacteristic(Characteristic.LockTargetState, Characteristic.LockTargetState.SECURED);
                            service.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
                            console.log(`[${device.name}] HomeKit Auto-Lock triggered after ${autoLockDelay}s`);
                        }, autoLockDelay * 1000);
                    } else {
                        console.log(`[${device.name}] No auto-lock delay configured, skipping forced updates.`);
                    }
                    break;
                default:
                    isUnlocking = false;
                    callback();
                    device.lock();
                    service.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
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

export function mergeLockDevices(device: ScryptedDevice & DeviceProvider, accessory: Accessory): { services: Service[], devices: (ScryptedDevice & Lock)[] } {
    if (!device.interfaces.includes(ScryptedInterface.DeviceProvider))
        return undefined;

    const children = getChildDevices(device);
    const mergedDevices = [];
    const services = children.map((child: ScryptedDevice & Lock) => {
        if (!child.interfaces.includes(ScryptedInterface.Lock) || !child.interfaces.includes(HOMEKIT_MIXIN))
            return undefined;

        const lockService = addLock(child, accessory);
        if (lockService) {
            mergedDevices.push(child);
        }
        return lockService;
    });

    return {
        services: services.filter(service => !!service),
        devices: mergedDevices,
    };
}

addSupportedType({
    type: ScryptedDeviceType.Lock,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.Lock);
    },
    getAccessory: async (device: ScryptedDevice & Lock, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);
        addLock(device, accessory);
        return accessory;
    }
});
