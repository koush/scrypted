import { Lock, LockState, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

addSupportedType({
    type: ScryptedDeviceType.Lock,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.Lock);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.LOCK');
        ret.traits.push('action.devices.traits.LockUnlock');
        return ret;
    },
    async query(device: ScryptedDevice & Lock) {
        const ret = queryResponse(device);
        switch (device.lockState) {
            case LockState.Jammed:
                ret.isJammed = true;
                ret.isLocked = false;
                break;
            case LockState.Unlocked:
                ret.isLocked = false;
                ret.isJammed = false;
                break;
            case LockState.Locked:
                ret.isLocked = true;
                ret.isJammed = false;
                break;
        }
        return ret;
    },
})
