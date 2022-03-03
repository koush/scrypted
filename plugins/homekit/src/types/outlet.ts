
import { OnOff, ScryptedDevice, ScryptedDeviceType } from '@scrypted/sdk'
import { addSupportedType, HomeKitSession } from '../common'
import { Service } from '../hap';
import { probe, getAccessory } from './onoff-base';

addSupportedType({
    type: ScryptedDeviceType.Outlet,
    probe,
    getAccessory: async (device: ScryptedDevice & OnOff, homekitSession: HomeKitSession) => {
        const {accessory, service} = getAccessory(device, homekitSession, Service.Outlet);
        return accessory;
    }
});
