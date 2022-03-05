import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk';
import { addSupportedType, HomeKitSession } from '../common';
import { Service } from '../hap';
import { getAccessory, probe } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Switch,
    probe,
    getAccessory: async (device: ScryptedDevice & OnOff, homekitSession: HomeKitSession) => {
        const {accessory, service} = getAccessory(device, homekitSession, Service.Switch);
        return accessory;
    }
});
