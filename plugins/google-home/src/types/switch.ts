import { Brightness, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

addSupportedType({
    type: ScryptedDeviceType.Switch,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.OnOff);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.SWITCH');
        ret.traits.push('action.devices.traits.OnOff');

        if (device.interfaces.includes(ScryptedInterface.Brightness))
            ret.traits.push('action.devices.traits.Brightness');
        return ret;
    },
    async query(device: ScryptedDevice & OnOff & Brightness) {
        const ret = queryResponse(device);
        ret.on = !!device.on;
        if (device.interfaces.includes(ScryptedInterface.Brightness))
            ret.brightness = device.brightness;
        return ret;
    },
})
