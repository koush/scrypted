import { SipRequestHandler, SipRequest } from "../../sip/src/sip-call";

export class CompositeSipMessageHandler extends SipRequestHandler {
    private handlers : SipRequestHandler[] = []
    constructor() {
        super()
    }
    handle(request: SipRequest) {
        this.handlers.forEach( (handler) => handler.handle( request )  )
    }
    add( handler : SipRequestHandler ) {
        this.handlers.push( handler )
    }
}