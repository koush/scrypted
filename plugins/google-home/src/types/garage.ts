import { BinarySensor, EntrySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

addSupportedType({
    type: ScryptedDeviceType.Garage,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.Entry) && device.interfaces.includes(ScryptedInterface.EntrySensor);
    },
    getSyncResponse: async (device) => {
        const ret = syncResponse(device, 'action.devices.types.GARAGE');
        ret.traits.push('action.devices.traits.OpenClose');

        ret.attributes.discreteOnlyOpenClose = true;
        if (!device.interfaces.includes(ScryptedInterface.Entry))
            ret.attributes.queryOnlyOpenClose = true;
        if (!device.interfaces.includes(ScryptedInterface.EntrySensor))
            ret.attributes.commandOnlyOpenClose = true;
        return ret;
    },
    async query(device: ScryptedDevice & EntrySensor) {
        const ret = queryResponse(device);
        ret.openPercent = device.entryOpen ? 100 : 0;
        return ret;
    },
})
