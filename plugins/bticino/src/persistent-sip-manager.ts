import { SipCallSession } from "../../sip/src/sip-call-session";
import { BticinoSipCamera } from "./bticino-camera";
import { SipHelper } from "./sip-helper";
import { SipManager, SipOptions } from "../../sip/src/sip-manager";

/**
 * This class registers itself with the SIP server as a contact for a user account.
 * The registration expires after the expires time in sipOptions is reached.
 * The sip session will re-register itself after the expires time is reached.
 */
const CHECK_INTERVAL : number = 10 * 1000
export class PersistentSipManager {
    
    private sipManager : SipManager
    private lastRegistration : number = 0
    private expireInterval : number = 0
    private timeout : NodeJS.Timeout

    constructor( private camera : BticinoSipCamera ) {
        // Give it a second and run in seperate thread to avoid failure on creation for from/to/domain check
        this.timeout = setTimeout( () => this.enable() , CHECK_INTERVAL )
    }

    async enable() : Promise<SipManager> {
        if( this.sipManager ) {
            return this.sipManager
        } else { 
            return this.register()
        }
    }

    private async register() : Promise<SipManager> {
        let now = Date.now()
        try {
            let sipOptions : SipOptions = SipHelper.sipOptions( this.camera )
            if( Number.isNaN( sipOptions.expire ) ||  sipOptions.expire <= 0 || sipOptions.expire > 3600 ) {
                sipOptions.expire = 300
            }
            if( this.expireInterval == 0 ) {
                this.expireInterval = (sipOptions.expire * 1000) - 10000
            }

            if( !this.camera.hasActiveCall() && now - this.lastRegistration >= this.expireInterval )  {
                let sipOptions : SipOptions = SipHelper.sipOptions( this.camera )

                this.sipManager?.destroy()
                this.sipManager = new SipManager(this.camera.console, sipOptions )
                await this.sipManager.register()

                this.lastRegistration = now

                return this.sipManager;
            }
        } catch(e) {
            this.camera.console.error("Error enabling persistent SIP manager: " + e )
            // Try again in a minute
            this.lastRegistration = now + (60 * 1000) - this.expireInterval
            throw e
        } finally {
            this.timeout = setTimeout( () => this.register(), CHECK_INTERVAL )      
        }
    }

    async session( sipOptions: SipOptions ) : Promise<SipCallSession> {
        let sm = await this.enable()
        return SipCallSession.createCallSession(this.camera.console, "Bticino", sipOptions, sm )
    }

    cancelTimer() {
        if( this.timeout ) {
            clearTimeout(this.timeout)
        }
    }

    reloadSipOptions() {
        this.sipManager?.setSipOptions( null )
    }
}