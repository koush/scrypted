import { ScryptedDeviceBase, Lock, LockState } from "@scrypted/sdk";
import { UnifiProtect } from "./main";
import { ProtectDoorLockConfig } from "./unifi-protect";

export class UnifiLock extends ScryptedDeviceBase implements Lock {
    constructor(public protect: UnifiProtect, nativeId: string, protectLock: Readonly<ProtectDoorLockConfig>) {
        super(nativeId);

        this.updateState(protectLock);
        this.console.log(protectLock);
    }

    async lock(): Promise<void> {
        await this.protect.loginFetch(this.protect.api.doorlocksUrl() + `/${this.nativeId}/close`, {
            method: 'POST',
        });
    }

    async unlock(): Promise<void> {
        await this.protect.loginFetch(this.protect.api.doorlocksUrl() + `/${this.nativeId}/open`, {
            method: 'POST',
        });
    }

    findLock() {
        return this.protect.api.doorlocks.find(doorlock => doorlock.id === this.nativeId);
    }

    updateState(lock?: Readonly<ProtectDoorLockConfig>) {
        lock = lock || this.findLock();
        if (!lock)
            return;
        this.lockState = lock.lockStatus === 'CLOSED' ? LockState.Locked : LockState.Unlocked;
    }
}
