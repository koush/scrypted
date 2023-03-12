import sdk, { ScryptedDeviceBase, Lock, LockState, HttpRequest, HttpResponse, HttpRequestHandler } from "@scrypted/sdk";
import { BticinoSipCamera } from "./bticino-camera";

export class BticinoSipLock extends ScryptedDeviceBase implements Lock, HttpRequestHandler {
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

    public async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.url.endsWith('/unlocked')) {
            this.lockState = LockState.Unlocked
            response.send('Success', {
                code: 200,
            });
        } else if( request.url.endsWith('/locked') ) {
            this.lockState = LockState.Locked
            response.send('Success', {
                code: 200,
            });
        } else if( request.url.endsWith('/lock') ) {
            this.lock();
            response.send('Success', {
                code: 200,
            });
        } else if( request.url.endsWith('/unlock') ) {
            this.unlock();
            response.send('Success', {
                code: 200,
            });                        
        } else {
            response.send('Unsupported operation', {
                code: 400,
            });
        }
    }    
}