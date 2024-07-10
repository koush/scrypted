import * as nodeIp from "ip";
import { get } from 'http'
import * as net from 'net'
import { BticinoSipCamera } from "./bticino-camera";
import { SipHelper } from './sip-helper';

export class ControllerApi {
    private timeout : NodeJS.Timeout

    constructor( private sipCamera : BticinoSipCamera ) {
        this.timeout = setTimeout( () => {
            // Delay a bit an run in a different thread in case this fails
            this.registerEndpoints( true )
        }, 5000 )        
    }

    /**
     * Will validate certain requirements for scrypted to work correctly with the intercom:
     */
    public static validate( ipAddress ) {
        return this.validateFlexisipSipPort(ipAddress).then( this.validateController )
    }

    /**
     * Will validate if the non secure SIP port was opened after modifying /etc/init.d/flexisipsh
     */
    private static validateFlexisipSipPort( ipAddress : string ) : Promise<string> {
        let conn = net.createConnection( { host: ipAddress, port: 5060, timeout: 5000 } )
        return new Promise( (resolve, reject) => {
            conn.setTimeout(5000);
            conn.on('connect', () => resolve( ipAddress ));
            conn.on('timeout', () => reject( new Error("Timeout connecting to port 5060, is this a Bticino intercom? Did you change /etc/init.d/flexisipsh to make it listen on this port?") ) );
            conn.on('error', () => reject( new Error("Error connecting to port 5060, is this a Bticino intercom? Did you change /etc/init.d/flexisipsh to make it listen on this port?") ) );
        })
    }

    /**
     * Will validate if the c300x-controller is running on port 8080.
     * The c300x-controller will return errors if some configuration errors are present on the intercom.
     */    
    private static validateController( ipAddress : string ) : Promise<void> {
        // Will throw an exception if invalid format
        const c300x =  nodeIp.toBuffer( ipAddress )
        const validatedIp = nodeIp.toString(c300x)

        const url = `http://${validatedIp}:8080/validate-setup?raw=true`

        return new Promise( (resolve, reject) => get(url, (res) => {
            let body = "";
            res.on("data", data => { body += data });
            res.on("end", () => {
                try {
                    let parsedBody = JSON.parse( body )
                    if( !parsedBody["model"] ) {
                        reject( new Error("Cannot determine model, update your c300x-controller.") )
                    }
                    if( parsedBody["errors"].length > 0 ) {
                        reject( new Error( parsedBody["errors"][0] ) )
                    } else {
                        parsedBody["ipAddress"] = validatedIp
                        resolve( parsedBody )
                    }
                } catch( e ) {
                    reject( e )
                }
            })
            res.on("error", (e) => { reject(e)})
            if( res.statusCode != 200 ) {
                reject( new Error(`Could not validate required c300x-controller. Check ${url}`) )
            }
        } ).on("error", (e) => { reject(`Could not connect to the c300x-controller at ${url}`) }) )
    }

    /**
     * This verifies if the intercom is customized correctly. It verifies:
     * 
     * - if a dedicated scrypted sip user is added for this specific camera instance in /etc/flexisip/users/users.db.txt
     * - if this dedicated scrypted sip user is configured in /etc/flexisip/users/route.conf and /etc/flexisip/users/route_int.conf
     */
    public registerEndpoints( verifyUser : boolean ) {
        let ipAddress = SipHelper.getIntercomIp(this.sipCamera)
        let sipFrom = SipHelper.getIdentifier(this.sipCamera)
        const pressed = Buffer.from(this.sipCamera.doorbellWebhookUrl + 'pressed').toString('base64')
        const locked = Buffer.from(this.sipCamera.doorbellLockWebhookUrl + 'locked').toString('base64')
        const unlocked = Buffer.from(this.sipCamera.doorbellLockWebhookUrl + 'unlocked').toString('base64')
        get(`http://${ipAddress}:8080/register-endpoint?raw=true&identifier=${sipFrom}&pressed=${pressed}&locked=${locked}&unlocked=${unlocked}&verifyUser=${verifyUser}`, (res) => {
            if( verifyUser ) {
                let body = "";
                res.on("data", data => { body += data });
                res.on("end", () => {
                    try {
                        let parsedBody = JSON.parse( body )
                        if( parsedBody["errors"].length > 0 ) {
                            this.sipCamera.log.a("This camera is not setup correctly, it will not be able to receive the incoming doorbell stream. Check the console for the errors.")
                            parsedBody["errors"].forEach( error => {
                                this.sipCamera.console.error( "ERROR: " + error )
                            });
                        }
                    } catch( e ) {
                        this.sipCamera.console.error("Error parsing body to JSON: " + body )
                    }
                })      
            }
            console.log("Endpoint registration status: " + res.statusCode)
        }).on('error', (e) => this.sipCamera.console.error(e) );   

        // The default evict time on the c300x-controller is 5 minutes, so this will certainly be within bounds
        this.timeout = setTimeout( () => this.registerEndpoints( false ) , 2 * 60 * 1000 )
    }

    /**
     * Informs the c300x-controller where to send the stream to
     */
    public updateStreamEndpoint() : Promise<void> {
        let ipAddress = SipHelper.getIntercomIp(this.sipCamera)
        let sipFrom = SipHelper.getIdentifier(this.sipCamera)
        return new Promise( (resolve, reject) => get(`http://${ipAddress}:8080/register-endpoint?raw=true&updateStreamEndpoint=${sipFrom}`, (res) => {
            if( res.statusCode != 200 ) reject( "ERROR: Could not update streaming endpoint, call returned: " + res.statusCode )
            else resolve()
        } ).on('error', (error) => this.sipCamera.console.error(error) ).end() );
    }

    public cancelTimer() {
        if( this.timeout ) {
            clearTimeout(this.timeout)
        }
    }    
}