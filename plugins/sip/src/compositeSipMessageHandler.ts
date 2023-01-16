import { SipMessageHandler, SipRequest } from "../../sip/src/sip-call";

export class CompositeSipMessageHandler extends SipMessageHandler {
    private handlers : SipMessageHandler[] = []
    constructor() {
        super()
    }
    handle(request: SipRequest) {
        this.handlers.forEach( (handler) => handler.handle( request )  )
    }
    add( handler : SipMessageHandler ) {
        this.handlers.push( handler )
    }
}