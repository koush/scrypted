import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk';
import { addSupportedType, HomeKitSession } from '../common';
import { Service } from '../hap';
import { getAccessory, probe } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Fan,
    probe,
    async getAccessory(device: ScryptedDevice & OnOff, homekitSession: HomeKitSession) {
        const {accessory, service} = getAccessory(device, homekitSession, Service.Fan);
        return accessory;
    }
});
