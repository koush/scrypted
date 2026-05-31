import { Brightness, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

addSupportedType({
    type: ScryptedDeviceType.Fan,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.OnOff);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.FAN');
        ret.traits.push('action.devices.traits.OnOff');
        ret.traits.push('action.devices.traits.FanSpeed');
        ret.attributes = {
            commandOnlyFanSpeed: true,

            "availableFanSpeeds": {
                "speeds": [
                ],
                "ordered": true
              },
        }
        return ret;
    },
    async query(device: ScryptedDevice & OnOff & Brightness) {
        const ret = queryResponse(device);
        ret.on = !!device.on;
        return ret;
    },
})
