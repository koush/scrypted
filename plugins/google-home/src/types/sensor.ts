import { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

addSupportedType({
    type: ScryptedDeviceType.Sensor,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.BinarySensor);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.DOOR');
        ret.traits.push('action.devices.traits.OpenClose');
        ret.attributes.queryOnlyOpenClose = true;
        return ret;
    },
    async query(device: ScryptedDevice & BinarySensor) {
        const ret = queryResponse(device);
        ret.openPercent = device.binaryState ? 100 : 0;
        return ret;
    },
})
