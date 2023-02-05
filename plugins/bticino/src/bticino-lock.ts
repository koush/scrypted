import { ScryptedDeviceBase, Lock, LockState } from "@scrypted/sdk";
import { BticinoSipCamera } from "./bticino-camera";

export class BticinoSipLock extends ScryptedDeviceBase implements Lock {
    private timeout : NodeJS.Timeout

    constructor(public camera: BticinoSipCamera) {
        super( camera.nativeId + "-lock")
    }

    lock(): Promise<void> {
        if( !this.timeout ) {
           this.timeout = setTimeout(() => {
            this.lockState = LockState.Locked
            this.timeout = undefined
           } , 3000);
        } else {
            this.camera.console.log("Still attempting previous locking ...")
        }        
        return
    }

    unlock(): Promise<void> {
        this.lockState = LockState.Unlocked
        this.lock()
        return this.camera.sipUnlock()
    }
}