import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk';
import { addSupportedType,  } from '../common';
import { Service } from '../hap';
import { getAccessory, probe } from './onoff-base';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.Fan,
    probe,
    async getAccessory(device: ScryptedDevice & OnOff, homekitPlugin: HomeKitPlugin) {
        const {accessory, service} = getAccessory(device, homekitPlugin, Service.Fan);
        return accessory;
    }
});
