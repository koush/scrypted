import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk';
import { addSupportedType,  } from '../common';
import { Service } from '../hap';
import { getAccessory, probe } from './onoff-base';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.Siren,
    probe,
    getAccessory: async (device: ScryptedDevice & OnOff, homekitPlugin: HomeKitPlugin) => {
        const {accessory, service} = getAccessory(device, homekitPlugin, Service.Switch);
        return accessory;
    }
});
