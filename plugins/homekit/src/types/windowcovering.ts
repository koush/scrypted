import { Brightness, Entry, EntrySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice, } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.WindowCovering,
    probe(device: DummyDevice): boolean {
        return (device.interfaces.includes(ScryptedInterface.Entry) && device.interfaces.includes(ScryptedInterface.EntrySensor))
            || device.interfaces.includes(ScryptedInterface.Brightness);
    },
    getAccessory: async (device: ScryptedDevice & Entry & EntrySensor & Brightness, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);

        const service = accessory.addService(Service.WindowCovering, device.name);

        if (device.interfaces.includes(ScryptedInterface.Entry)) {
            bindCharacteristic(device, ScryptedInterface.EntrySensor, service, Characteristic.CurrentPosition,
                () => !!device.entryOpen ? 100 : 0);

            let targetPosition = !!device.entryOpen ? 100 : 0;
            bindCharacteristic(device, ScryptedInterface.EntrySensor, service, Characteristic.TargetPosition,
                () => !!device.entryOpen ? 100 : 0);

            const props = {
                minValue: 0,
                maxValue: 100,
                minStep: 100,
            };
            service.getCharacteristic(Characteristic.TargetPosition)
                .setProps(props)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    if (value === 100) {
                        targetPosition = 100;
                        device.openEntry();
                    }
                    else {
                        targetPosition = 0;
                        device.closeEntry();
                    }
                });
        }
        else if (device.interfaces.includes(ScryptedInterface.Brightness)) {
            bindCharacteristic(device, ScryptedInterface.Brightness, service, Characteristic.CurrentPosition,
                () => device.brightness || 0);

            let targetPosition = device.brightness || 0;
            bindCharacteristic(device, ScryptedInterface.Brightness, service, Characteristic.TargetPosition,
                () => device.brightness || 0);

            const props = {
                minValue: 0,
                maxValue: 100,
                minStep: 1,
            };
            service.getCharacteristic(Characteristic.TargetPosition)
                .setProps(props)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    targetPosition = value as number;
                    device.setBrightness(targetPosition);
                });
        }

        return accessory;
    }
});
