import { ScryptedDeviceBase, HttpRequest, HttpResponse, HttpRequestHandler, OnOff } from "@scrypted/sdk";
import { BticinoSipCamera } from "./bticino-camera";
import { VoicemailHandler } from "./bticino-voicemailHandler";

export class BticinoAswmSwitch extends ScryptedDeviceBase implements OnOff, HttpRequestHandler {
    private timeout : NodeJS.Timeout
    private voicemailHandler : VoicemailHandler

    constructor(private camera: BticinoSipCamera) {
        super( camera.nativeId + "-aswm-switch")
        this.voicemailHandler = new VoicemailHandler(camera)
        camera.requestHandlers.add(this.voicemailHandler)
        this.timeout = setTimeout( () => this.syncStatus() , 5000 )
    }

    turnOff(): Promise<void> {
        this.on = false
        return this.camera.turnOffAswm()
    }

    turnOn(): Promise<void> {
        this.on = true
        return this.camera.turnOnAswm()
    }

    syncStatus() {
        this.on = this.voicemailHandler.isAswmEnabled()
        this.timeout = setTimeout( () => this.syncStatus() , 5000 )
    }

    cancelTimer() {
        if( this.timeout ) {
            clearTimeout(this.timeout)
        }
        this.voicemailHandler?.cancelTimer()
    }

    public async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.url.endsWith('/disabled')) {
            this.on = false
            response.send('Success', {
                code: 200,
            });
        } else if( request.url.endsWith('/enabled') ) {
            this.on = true
            response.send('Success', {
                code: 200,
            });
        } else if( request.url.endsWith('/enable') ) {
            this.turnOn()
            response.send('Success', {
                code: 200,
            });
        } else if( request.url.endsWith('/disable') ) {
            this.turnOff()
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