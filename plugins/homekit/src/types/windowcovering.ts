import { Entry, EntrySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice, } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.WindowCovering,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.Entry) && device.interfaces.includes(ScryptedInterface.EntrySensor);
    },
    getAccessory: async (device: ScryptedDevice & Entry & EntrySensor, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);

        const service = accessory.addService(Service.WindowCovering, device.name);

        bindCharacteristic(device, ScryptedInterface.EntrySensor, service, Characteristic.CurrentPosition,
            () => !!device.entryOpen ? 100 : 0);

        bindCharacteristic(device, ScryptedInterface.EntrySensor, service, Characteristic.TargetPosition,
            () => !!device.entryOpen ? 100 : 0);

        let props = {
            minValue: 0,
            maxValue: 100,
            minStep: 100,
        };
        let targetState = !!device.entryOpen ? 100 : 0;
        service.getCharacteristic(Characteristic.TargetPosition)
            .setProps(props)
            .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, targetState);
            })
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
                if (value === 100) {
                    targetState = 100;
                    device.openEntry();
                }
                else {
                    targetState = 0;
                    device.closeEntry();
                }
            })

        return accessory;
    }
});
