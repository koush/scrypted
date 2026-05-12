import sdk, { BinarySensor, Lock, LockState, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, DummyDevice, supportedTypes } from '../common';
import { Characteristic, CharacteristicEventTypes, Service, StatelessProgrammableSwitch } from '../hap';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";
import { createCameraStorageSettings } from '../camera-mixin';

addSupportedType({
    type: ScryptedDeviceType.Doorbell,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.BinarySensor);
    },
    getAccessory: async (device: ScryptedDevice & BinarySensor, homekitPlugin: HomeKitPlugin) => {
        const faux: DummyDevice = {
            interfaces: device.interfaces,
            type: device.type,
        };
        faux.type = ScryptedDeviceType.Camera;
        const cameraCheck = supportedTypes[ScryptedInterface.Camera];
        const accessory = cameraCheck.probe(faux) ? await cameraCheck.getAccessory(device, homekitPlugin) : makeAccessory(device, homekitPlugin);

        const service = accessory.addService(Service.Doorbell);

        const storage = sdk.deviceManager.getMixinStorage(device.id, homekitPlugin.nativeId);
        const cameraStorage = createCameraStorageSettings({ storage, onDeviceEvent: undefined });

        const stateless = cameraStorage.values.doorbellAutomationButton ? new StatelessProgrammableSwitch(device.name, undefined) : undefined;
        if (stateless) {
            stateless.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .setProps({
                    maxValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
                });

            accessory.addService(stateless);
        }

        device.listen({
            event: ScryptedInterface.BinarySensor,
            watch: false,
        }, () => {
            if (device.binaryState) {
                service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
                stateless?.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
            }
        });

        service
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            // Provide the status of this doorbell. This must always return null, per the HomeKit spec.
            .on(CharacteristicEventTypes.GET, callback => callback(null, null));

        service.setPrimaryService(true);

        if (device.interfaces.includes(ScryptedInterface.Lock)) {
            const lockDevice = device as ScryptedDevice & Lock;
            const lockService = accessory.addService(Service.LockMechanism, device.name);

            const toCurrentState = () => lockDevice.lockState === LockState.Locked
                ? Characteristic.LockCurrentState.SECURED
                : Characteristic.LockCurrentState.UNSECURED;

            const toTargetState = () => lockDevice.lockState === LockState.Locked
                ? Characteristic.LockTargetState.SECURED
                : Characteristic.LockTargetState.UNSECURED;

            lockService.getCharacteristic(Characteristic.LockCurrentState)
                .on(CharacteristicEventTypes.GET, callback => callback(null, toCurrentState()));

            lockService.getCharacteristic(Characteristic.LockTargetState)
                .on(CharacteristicEventTypes.GET, callback => callback(null, toTargetState()))
                .on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    value === Characteristic.LockTargetState.UNSECURED
                        ? lockDevice.unlock()
                        : lockDevice.lock();
                    setTimeout(() => {
                        const cs = value === Characteristic.LockTargetState.UNSECURED
                            ? Characteristic.LockCurrentState.UNSECURED
                            : Characteristic.LockCurrentState.SECURED;
                        lockService.updateCharacteristic(Characteristic.LockCurrentState, cs);
                        lockService.updateCharacteristic(Characteristic.LockTargetState, value);
                    }, 150);
                });

            device.listen({ event: ScryptedInterface.Lock, watch: false }, () => {
                lockService.updateCharacteristic(Characteristic.LockCurrentState, toCurrentState());
                lockService.updateCharacteristic(Characteristic.LockTargetState, toTargetState());
            });

            service.addLinkedService(lockService);
        }

        return accessory;
    }
});
