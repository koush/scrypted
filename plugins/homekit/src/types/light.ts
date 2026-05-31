import { Brightness, ColorSettingHsv, ColorSettingTemperature, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { getAccessory, probe } from './onoff-base';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.Light,
    probe,
    getAccessory: async (device: ScryptedDevice & OnOff & Brightness & ColorSettingHsv & ColorSettingTemperature, homekitPlugin: HomeKitPlugin) => {
        const { accessory, service } = getAccessory(device, homekitPlugin, Service.Lightbulb);

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
                });

            service.addCharacteristic(Characteristic.Saturation)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    s = value as number;
                    delaySet();
                });

            bindCharacteristic(device, ScryptedInterface.ColorSettingHsv, service, Characteristic.Hue,
                () => device.hsv?.h || 0);

            bindCharacteristic(device, ScryptedInterface.ColorSettingHsv, service, Characteristic.Saturation,
                () => (device.hsv?.s || 0) * 100);
        }
        if (device.interfaces.includes(ScryptedInterface.ColorSettingTemperature)) {
            // HomeKit uses micro-reciprocal degrees as a color temperature unit. 1 degree = 1,000,000 / K
            service.addCharacteristic(Characteristic.ColorTemperature)
                .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                    callback();
                    device.setColorTemperature(Math.round(1e6 / (value as number)));
                });
            bindCharacteristic(device, ScryptedInterface.ColorSettingTemperature, service, Characteristic.ColorTemperature, () => Math.round(1e6 / device.colorTemperature));
        }
        return accessory;
    }
});
