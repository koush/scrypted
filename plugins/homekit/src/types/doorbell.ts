
import { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { Characteristic, CharacteristicEventTypes, CharacteristicGetCallback, Service, ContactSensor, StatelessProgrammableSwitch } from '../hap';
import { addSupportedType, bindCharacteristic, DummyDevice, HomeKitSession, supportedTypes } from '../common'
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Doorbell,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.BinarySensor);
    },
    getAccessory: async (device: ScryptedDevice & BinarySensor, homekitSession: HomeKitSession) => {
        const faux: DummyDevice = {
            interfaces: device.interfaces,
            type: device.type,
        };
        faux.type = ScryptedDeviceType.Camera;
        const cameraCheck = supportedTypes[ScryptedInterface.Camera];
        const accessory = cameraCheck.probe(faux) ? await cameraCheck.getAccessory(device, homekitSession) : makeAccessory(device);

        const service = accessory.addService(Service.Doorbell);

        const stateless = new StatelessProgrammableSwitch(device.name, undefined);
        stateless.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .setProps({
                maxValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
            });

        accessory.addService(stateless);

        device.listen({
            event: ScryptedInterface.BinarySensor,
            watch: false,
        }, () => {
            if (device.binaryState) {
                service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
                stateless.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
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
