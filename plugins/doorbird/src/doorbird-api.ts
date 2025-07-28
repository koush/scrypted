import Doorbird, { DoorbirdUdpSocket, Scheme, Response, DoorbirdInfoBHA } from 'doorbird';

export interface ApiRingEvent {
    event: string;
    timestamp: Date;
}
export interface ApiMotionEvent {
    timestamp: Date;
}

export type ApiRingCallback = (event: ApiRingEvent) => void;
export type ApiMotionCallback = (event: ApiMotionEvent) => void;

export class DoorbirdAPI {

    private console?: Console
    private doorbird: Doorbird;
    private doorbirdUdpSocket: DoorbirdUdpSocket;
    private ringCallback: ApiRingCallback;
    private motionCallback: ApiMotionCallback;
    private intercomId: String;

    constructor(host: string, username: string, password: string, console?: Console) {
        this.console = console;
        this.doorbird = new Doorbird({
            scheme: Scheme.http,
            host: host,
            username: username,
            password: password
        });
        this.intercomId = username.substring(0, 6);
        this.console?.log("Doorbird: Our intercomId is: ", this.intercomId);
    }

    startEventSocket() {
        this.console?.log("Doorbird: starting event socket listening...");

        // initialize dgram UDP socket where Doorbird stations broadcast their event info
        this.doorbirdUdpSocket = this.doorbird.startUdpSocket(6524); // 6524 or 35344 - both shall contain the same payload

        // register a listener for ring events
        this.doorbirdUdpSocket.registerRingListener(ringEvent => {
            this.console?.log("Doorbird: Event from IntercomId:", ringEvent.intercomId);
            // Make sure that we only call this if the intercom ID matches our desired one
            if (ringEvent.intercomId === this.intercomId) {
                this.ringCallback({
                    event: ringEvent.event,
                    timestamp: ringEvent.timestamp
                });
            }
        });

        // register a listener for motion events
        this.doorbirdUdpSocket.registerMotionListener(motionEvent => {
            this.console?.log("Doorbird: Event from IntercomId:", motionEvent.intercomId);
            // Make sure that we only call this if the intercom ID matches our desired one
            if (motionEvent.intercomId === this.intercomId) {
                this.motionCallback({
                    timestamp: motionEvent.timestamp
                });
            }
        });
    }

    stopEventSocket() {
        this.console?.log("Doorbird: stopping event socket listening...");
        this.doorbirdUdpSocket.close();        
    }

    registerRingCallback(ringCallback: ApiRingCallback) {
        this.ringCallback = ringCallback;
    }

    registerMotionCallback(motionCallback: ApiMotionCallback) {
        this.motionCallback = motionCallback;
    }

    async getImage(): Promise<Buffer> {
        this.console?.log("Doorbird: getting JPEG image...");
        return this.doorbird.getImage();
    }

    async getInfo(): Promise<any> {
        const dbInfo = await this.doorbird.getInfo();
        return {
            deviceType: dbInfo.BHA.VERSION[0]['DEVICE-TYPE'],
            firmwareVersion: dbInfo.BHA.VERSION[0].FIRMWARE,
            buildNumber: dbInfo.BHA.VERSION[0].BUILD_NUMBER,
            serialNumber: dbInfo.BHA.VERSION[0].WIFI_MAC_ADDR,
        }
    }
}