
import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk'
import { addSupportedType } from '../common'
import { Service } from '../hap';
import { probe, getAccessory } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Outlet,
    probe,
    getAccessory: (device: ScryptedDevice & OnOff) => {
        const {accessory, service} = getAccessory(device, Service.Outlet);
        return accessory;
    }
});
