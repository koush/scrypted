import { SipRequestHandler, SipRequest } from "../../sip/src/sip-manager"
import { BticinoSipCamera } from "./bticino-camera"
import { stringifyUri } from '@slyoldfox/sip'

export class InviteHandler extends SipRequestHandler {
    constructor( private sipCamera : BticinoSipCamera ) {
        super()
        this.sipCamera.binaryState = false
    }

    handle(request: SipRequest) {
        //TODO: restrict this to call from:c300x@ AND to:alluser@ ?
        if( request.method == 'CANCEL' ) {
            let reason = request.headers["reason"] ? ( ' - ' + request.headers["reason"] ) : ''
            this.sipCamera.console.log('CANCEL voice call from: ' + stringifyUri( request.headers.from.uri ) + ' to: ' + stringifyUri( request.headers.to.uri ) + reason )
            this.sipCamera?.reset()
        }
        if( request.method === 'INVITE' ) {
            this.sipCamera.console.log("INCOMING voice call from: " + stringifyUri( request.headers.from.uri ) + ' to: ' + stringifyUri( request.headers.to.uri ) )

            this.sipCamera.binaryState = true
            this.sipCamera.incomingCallRequest = request

            setTimeout( () => {
                // Assumption that flexisip only holds this call active for 20 seconds ... might be revised
                this.sipCamera?.reset()
            }, 20 * 1000 )
        }
    }


}