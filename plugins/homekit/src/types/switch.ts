
import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk'
import { addSupportedType } from '../common'
import { Service } from '../hap';
import { probe, getAccessory } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Switch,
    probe,
    getAccessory: (device: ScryptedDevice & OnOff) => {
        const {accessory, service} = getAccessory(device, Service.Switch);
        return accessory;
    }
});
