import { OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

addSupportedType({
    type: ScryptedDeviceType.Outlet,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.OnOff);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.OUTLET');
        ret.traits.push('action.devices.traits.OnOff');
        return ret;
    },
    async query(device: ScryptedDevice & OnOff) {
        const ret = queryResponse(device);
        ret.on = !!device.on;
        return ret;
    },
})
