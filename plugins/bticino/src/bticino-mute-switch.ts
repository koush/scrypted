import { ScryptedDeviceBase, HttpRequest, HttpResponse, HttpRequestHandler, OnOff } from "@scrypted/sdk";
import { BticinoSipCamera } from "./bticino-camera";

export class BticinoMuteSwitch extends ScryptedDeviceBase implements OnOff, HttpRequestHandler {
    private timeout : NodeJS.Timeout

    constructor(private camera: BticinoSipCamera) {
        super( camera.nativeId + "-mute-switch");
        this.on = false;
        this.timeout = setTimeout( () => this.syncStatus() , 5000 )
    }

    turnOff(): Promise<void> {
        this.on = false
        return this.camera.muteRinger(false)
    }

    turnOn(): Promise<void> {
        this.on = true
        return this.camera.muteRinger(true)
    }

    syncStatus() {
        this.camera.muteStatus().then( (value) => {
            this.on = value["status"]
        }  ).catch( (e) => { this.camera.console.error(e) } ).finally( () => {
            this.timeout = setTimeout( () => this.syncStatus() , 60000 )
        } )
    }

    cancelTimer() {
        if( this.timeout ) {
            clearTimeout(this.timeout)
        }
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