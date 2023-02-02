import { SipRequestHandler, SipRequest } from "../../sip/src/sip-manager"
import { BticinoSipCamera } from "./bticino-camera"

export class InviteHandler extends SipRequestHandler {
    constructor( private sipCamera : BticinoSipCamera ) {
        super()
    }

    handle(request: SipRequest) {
        if( request.method === 'INVITE' ) {
            this.sipCamera.console.log("INCOMING voice call from: " + request.headers.from )
            this.sipCamera.binaryState = true

            setTimeout( () => {
                // Assumption that flexisip only holds this call active for 20 seconds ... might be revised
                this.sipCamera.binaryState = false
            }, 20 * 1000 )
        }
    }    
}