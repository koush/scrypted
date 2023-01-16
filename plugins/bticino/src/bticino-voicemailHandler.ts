import { SipMessageHandler, SipRequest } from "../../sip/src/sip-call";
import { BticinoSipCamera } from "./bticino-camera";

export class VoicemailHandler extends SipMessageHandler {
    private sipCamera : BticinoSipCamera
    
    constructor( sipCamera : BticinoSipCamera ) {
        super()
        this.sipCamera = sipCamera
        this.checkVoicemail()
    }

    checkVoicemail() {
        if( !this.sipCamera )
            return
        if( this.isEnabled() ) {
            this.sipCamera.console.info("Checking answering machine.")
            this.sipCamera.getAswmStatus().catch( e => this.sipCamera.console.error(e) )
        } else {
            this.sipCamera.console.info("Answering machine check not enabled.")
        }
        //TODO: make interval customizable, now every 5 minutes
        setTimeout( () => this.checkVoicemail() , 5 * 60 * 1000 )
    }

    handle(request: SipRequest) {
        if( this.isEnabled() ) {
            const lastVoicemailMessageTimestamp : number = Number.parseInt( this.sipCamera.storage.getItem('lastVoicemailMessageTimestamp') ) || -1
            const message : string = request.content.toString()
            if( message.startsWith('*#8**40*0*0*1176*0*2##') ) {
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
        }
    }

    isEnabled() : boolean {
        return this.sipCamera?.storage?.getItem('notifyVoicemail')?.toLocaleLowerCase() === 'true' || false
    }
}  