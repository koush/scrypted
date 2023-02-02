import { SipCallSession } from "../../sip/src/sip-call-session";
import { BticinoSipCamera } from "./bticino-camera";
import { SipHelper } from "./sip-helper";
import { SipManager, SipOptions } from "../../sip/src/sip-manager";

/**
 * This class registers itself with the SIP server as a contact for a user account.
 * The registration expires after the expires time in sipOptions is reached.
 * The sip session will re-register itself after the expires time is reached.
 */
export class SipRegisteredSession {
    private currentSipSession : SipCallSession

    constructor( private camera : BticinoSipCamera ) {
        // Give it a second
       setTimeout( () => this.enable(), 10 * 1000 )
    }

    async enable() : Promise<SipManager> {
        if( this.currentSipSession ) {
            return this.currentSipSession.sipCall
        }
        let sipOptions : SipOptions = SipHelper.sipOptions( this.camera )

        if( sipOptions.expire <= 0 || sipOptions.expire > 3600 ) {
            // Safe guard just in case
            sipOptions.expire = 300
        }
        
        setTimeout( () => {
            this.currentSipSession?.stop()
            this.currentSipSession = undefined
            this.enable()
        }, sipOptions.expire * 1000 )
        
        try {
            this.currentSipSession = await SipHelper.sipSession( sipOptions )
            await this.currentSipSession.sipCall.register()
            return this.currentSipSession.sipCall  
        } catch(e) {
            this.currentSipSession?.stop()
            this.currentSipSession = undefined
            this.camera.console.error("Error enabling SIP session: " + e )
            throw e
        }
    }
}