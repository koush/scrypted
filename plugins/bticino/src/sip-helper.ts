import { SipOptions } from "../../sip/src/sip-manager";
import { BticinoSipCamera } from "./bticino-camera";

export class SipHelper {
    public static sipOptions( camera : BticinoSipCamera ) : SipOptions {
        // Might be removed soon?
        if( camera.storage.getItem('sipto') && camera.storage.getItem('sipto').toString().indexOf(';') > 0 ) {
            camera.storage.setItem('sipto', camera.storage.getItem('sipto').toString().split(';')[0] )
        }
        const from = camera.storage.getItem('sipfrom')?.trim()
        const to = camera.storage.getItem('sipto')?.trim()
        const localIp = from?.split(':')[0].split('@')[1]
        // Although this might not occur directly, each camera should run on its own port
        // Might need to use a random free port here (?)
        const localPort = parseInt(from?.split(':')[1]) || 5060
        const domain = camera.storage.getItem('sipdomain')?.trim()
        const expiration : string = camera.storage.getItem('sipexpiration')?.trim() || '600'
        const sipdebug : boolean = camera.storage.getItem('sipdebug')?.toLocaleLowerCase() === 'true' || false

        if (!from || !to || !localIp || !localPort || !domain || !expiration ) {
            camera.log.e('Error: SIP From/To/Domain URIs not specified!')
            throw new Error('SIP From/To/Domain URIs not specified!')
        }        

        return { 
            from: "sip:" + from,
            //TCP is more reliable for large messages, also see useTcp=true below
            to: "sip:" + to + ";transport=tcp",
            domain: domain,
            expire: Number.parseInt( expiration ),
            localIp,
            localPort,
            debugSip: sipdebug,
            gruuInstanceId: camera.getGruuInstanceId(),
            useTcp: true,
            sipRequestHandler: camera.requestHandlers
         } 
    }    
}