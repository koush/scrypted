import { SipOptions } from "../../sip/src/sip-manager";
import { BticinoSipCamera } from "./bticino-camera";
import crypto from 'crypto';

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
            gruuInstanceId: SipHelper.getGruuInstanceId(camera),
            useTcp: true,
            sipRequestHandler: camera.requestHandlers

         } 
    }    
    
    public static getIdentifier( camera : BticinoSipCamera ) : string {
        let to = camera.storage.getItem('sipfrom')?.trim();
        const domain = camera.storage.getItem('sipdomain')?.trim()
        if( to ) {
            return to.split('@')[0] + '%40' + domain;
        }
        return     
    }

    public static getIntercomIp( camera : BticinoSipCamera ): string {
        let to = camera.storage.getItem('sipto')?.trim();
        if( to  ) {
            return to.split('@')[1];
        }
        return
    }

    public static getGruuInstanceId( camera : BticinoSipCamera ): string {
        let md5 = camera.storage.getItem('md5hash')
        if( !md5 ) {
            md5 = crypto.createHash('md5').update( camera.nativeId ).digest("hex")
            md5 = md5.substring(0, 8) + '-' + md5.substring(8, 12) + '-' + md5.substring(12,16) + '-' + md5.substring(16, 32)
            camera.storage.setItem('md5hash', md5)
        }
        return md5
    }    
}