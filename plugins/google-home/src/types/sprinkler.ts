import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface, StartStop } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';


addSupportedType({
    type: ScryptedDeviceType.Irrigation,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.StartStop);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.SPRINKLER');
        ret.traits.push('action.devices.traits.StartStop');
        return ret;
    },
    async query(device: ScryptedDevice & StartStop) {
        const ret = queryResponse(device);
        ret.isRunning = !!device.running;
        return ret;
    },
})
