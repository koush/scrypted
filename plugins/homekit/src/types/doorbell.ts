import sdk, { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
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

        return accessory;
    }
});
