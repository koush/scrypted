
import { BinarySensor, Dock, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, StartStop } from '@scrypted/sdk'
import { addSupportedType, DummyDevice, listenCharacteristic, supportedTypes } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';

addSupportedType({
    type: ScryptedDeviceType.Doorbell,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.BinarySensor);
    },
    getAccessory: (device: ScryptedDevice & BinarySensor) => {
        const faux: DummyDevice = {
            interfaces: device.interfaces,
            type: device.type,
        };
        faux.type = ScryptedDeviceType.Camera;
        const cameraCheck = supportedTypes[ScryptedInterface.Camera];
        const accessory = cameraCheck.probe(faux) ? cameraCheck.getAccessory(device) : makeAccessory(device);

        const service = accessory.addService(Service.Doorbell, device.name);
        service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, !!device.binaryState);
            });

        listenCharacteristic(device, ScryptedInterface.BinarySensor, service, Characteristic.ProgrammableSwitchEvent, true);

        return accessory;
    }
});
