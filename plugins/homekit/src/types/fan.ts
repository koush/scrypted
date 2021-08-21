
import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk'
import { addSupportedType } from '../common'
import { Service } from '../hap';
import { getAccessory, probe } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Fan,
    probe,
    getAccessory(device: ScryptedDevice & OnOff) {
        const {accessory, service} = getAccessory(device, Service.Fan);
        return accessory;
    }
});
