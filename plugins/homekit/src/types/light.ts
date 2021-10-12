
import { Brightness, ColorSettingHsv, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic } from '../common'
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service, NodeCallback } from '../hap';
import { probe, getAccessory } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Light,
    probe,
    getAccessory: async (device: ScryptedDevice & OnOff & Brightness & ColorSettingHsv) => {
        const { accessory, service } = getAccessory(device, Service.Lightbulb);

        if (device.interfaces.includes(ScryptedInterface.Brightness)) {
            service.addCharacteristic(Characteristic.Brightness)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    device.setBrightness(value as number);
                });

            bindCharacteristic(device, ScryptedInterface.Brightness, service, Characteristic.Brightness, () => Math.min(Math.max(device.brightness || 0, 0), 100));
        }

        let h: number;
        let s: number;

        let timeout: NodeJS.Timeout;
        const delaySet = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => device.setHsv(h, s / 100, (device.brightness || 0) / 100), 100);
        };

        if (device.interfaces.includes(ScryptedInterface.ColorSettingHsv)) {
            service.addCharacteristic(Characteristic.Hue)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    h = value as number;
                    delaySet();
                })
                .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                    callback(null, device.hsv?.h || 0);
                });

            service.addCharacteristic(Characteristic.Saturation)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    s = value as number;
                    delaySet();
                })
                .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                    callback(null, (device.hsv?.s || 0) * 100);
                });

        }

        return accessory;
    }
});
