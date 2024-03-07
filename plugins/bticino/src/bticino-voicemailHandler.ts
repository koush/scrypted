import { SipRequestHandler, SipRequest } from "../../sip/src/sip-manager"
import { BticinoSipCamera } from "./bticino-camera"

export class VoicemailHandler extends SipRequestHandler {
    private timeout : NodeJS.Timeout
    private aswmIsEnabled: boolean
    
    constructor( private sipCamera : BticinoSipCamera ) {
        super()
        this.timeout = setTimeout( () => {
            // Delay a bit an run in a different thread in case this fails
            this.checkVoicemail()
        }, 10000 )
    }

    checkVoicemail() {
        if( !this.sipCamera )
            return

        this.sipCamera.console.debug("Checking answering machine, cameraId: " + this.sipCamera.id )
        this.sipCamera.getAswmStatus().catch( e => this.sipCamera.console.error(e) )

        //TODO: make interval customizable, now every minute
        this.timeout = setTimeout( () => this.checkVoicemail() , 1 * 60 * 1000 )
    }

    cancelTimer() {
        if( this.timeout ) {
            clearTimeout(this.timeout)
        }
    }

    handle(request: SipRequest) {
        const lastVoicemailMessageTimestamp : number = Number.parseInt( this.sipCamera.storage.getItem('lastVoicemailMessageTimestamp') ) || -1
        const message : string = request.content.toString()
        let matches : Array<RegExpMatchArray> = [...message.matchAll(/\*#8\*\*40\*([01])\*([01])\*/gm)]
        if( matches && matches.length > 0 && matches[0].length > 0 ) {
            this.sipCamera.console.debug(  "Answering machine state: " + matches[0][1] + " / Welcome message state: " + matches[0][2] );
            this.aswmIsEnabled = matches[0][1] == '1';
            if( this.isEnabled() ) {
                this.sipCamera.console.debug("Handling incoming answering machine reply")
                const messages : string[] = message.split(';')
                let lastMessageTimestamp : number = 0
                let countNewMessages : number = 0
                messages.forEach( (message, index) => {
                    if( index > 0 ) {
                        const parts = message.split('|')
                        if( parts.length == 4 ) {
                            let messageTimestamp = Number.parseInt( parts[2] )
                            if( messageTimestamp > lastVoicemailMessageTimestamp )
                                countNewMessages++
                            if( index == messages.length-2 ) 
                                lastMessageTimestamp = messageTimestamp
                        }
                    }
                } )
                if( (lastVoicemailMessageTimestamp == null && lastMessageTimestamp > 0) ||
                    ( lastVoicemailMessageTimestamp != null && lastMessageTimestamp > lastVoicemailMessageTimestamp ) ) {
                    this.sipCamera.log.a(`You have ${countNewMessages} new voicemail messages.`)
                    this.sipCamera.storage.setItem('lastVoicemailMessageTimestamp', lastMessageTimestamp.toString())
                    } else {
                    this.sipCamera.console.debug("No new messages since: " + lastVoicemailMessageTimestamp + " lastMessage: " + lastMessageTimestamp)
                }
            }
        } else {
            this.sipCamera.console.debug("Not handling message: " + message)
        }
    }

    isEnabled() : boolean {
        return this.sipCamera?.storage?.getItem('notifyVoicemail')?.toLocaleLowerCase() === 'true' || false
    }

    isAswmEnabled() : boolean {
        return this.aswmIsEnabled
    }
}  