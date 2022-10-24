import { Lock, LockState} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { DoorLockMode } from "zwave-js";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class LockToDoorLock extends ZwaveDeviceBase implements Lock {
    async lock(): Promise<void> {
        const cc = this.instance.commandClasses['Door Lock'];
        await cc.set(DoorLockMode.Secured);
        this.lockState = LockState.Locked;
    }
    async unlock(): Promise<void> {
        const cc = this.instance.commandClasses['Door Lock'];
        await cc.set(DoorLockMode.Unsecured);
        this.lockState = LockState.Unlocked;
    }
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.lockState = zwaveDevice.getValue(valueId) ? LockState.Locked :
            zwaveDevice.transientState.lockJammed ? LockState.Jammed : LockState.Unlocked;
    }
}

export default LockToDoorLock;
