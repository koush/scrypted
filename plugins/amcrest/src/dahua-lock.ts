import { Lock, LockState, ScryptedDeviceBase } from "@scrypted/sdk";
import type { AmcrestCamera } from "./main";

export class DahuaLock extends ScryptedDeviceBase implements Lock {
    autoLockTimeout: NodeJS.Timeout;

    constructor(public camera: AmcrestCamera, nativeId: string) {
        super(nativeId);
        // door strikes do not report their state and lock again on their own.
        this.lockState = LockState.Locked;
    }

    async lock(): Promise<void> {
        if (!await this.camera.getClient().lock())
            throw new Error('Could not lock');
        clearTimeout(this.autoLockTimeout);
        this.lockState = LockState.Locked;
    }

    async unlock(): Promise<void> {
        if (!await this.camera.getClient().unlock())
            throw new Error('Could not unlock');
        this.lockState = LockState.Unlocked;

        // mirror the door strike locking again after the unlock period configured on the intercom.
        let delay = 5;
        try {
            const interval = await this.camera.getClient().getUnlockHoldInterval();
            // intercoms report seconds, some access controllers milliseconds.
            delay = interval >= 100 ? interval / 1000 : interval;
        }
        catch (e) {
            this.camera.console.warn('Unable to read the unlock period, using the default.', e);
        }
        clearTimeout(this.autoLockTimeout);
        this.autoLockTimeout = setTimeout(() => this.lockState = LockState.Locked, delay * 1000);
    }
}
