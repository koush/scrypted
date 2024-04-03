import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { readLine } from '@scrypted/common/src/read-stream';
import { parseHeaders, readBody } from '@scrypted/common/src/rtsp-server';
import contentType from 'content-type';
import { IncomingMessage } from 'http';
import { EventEmitter, Readable } from 'stream';
import { Destroyable } from '../../rtsp/src/rtsp';
import { getDeviceInfo } from './probe';
import { Point } from '@scrypted/sdk';

// {
//     "Action" : "Cross",
//     "Class" : "Normal",
//     "CountInGroup" : 1,
//     "DetectRegion" : [
//        [ 455, 260 ],
//        [ 3586, 260 ],
//        [ 3768, 7580 ],
//        [ 382, 7451 ]
//     ],
//     "Direction" : "Enter",
//     "EventID" : 10181,
//     "GroupID" : 0,
//     "Name" : "Rule1",
//     "Object" : {
//        "Action" : "Appear",
//        "BoundingBox" : [ 2856, 1280, 3880, 4880 ],
//        "Center" : [ 3368, 3080 ],
//        "Confidence" : 0,
//        "LowerBodyColor" : [ 0, 0, 0, 0 ],
//        "MainColor" : [ 0, 0, 0, 0 ],
//        "ObjectID" : 863,
//        "ObjectType" : "Human",
//        "RelativeID" : 0,
//        "Speed" : 0
//     },
//     "PTS" : 43380319830.0,
//     "RuleID" : 2,
//     "Track" : [],
//     "UTC" : 1711446999,
//     "UTCMS" : 701
//  }
export interface AmcrestObjectDetails {
    Action: string;
    BoundingBox: Point;
    Center: Point;
    Confidence: number;
    LowerBodyColor: [number, number, number, number];
    MainColor: [number, number, number, number];
    ObjectID: number;
    ObjectType: string;
    RelativeID: number;
    Speed: number;
}

export interface AmcrestEventData {
    Action: string;
    Class: string;
    CountInGroup: number;
    DetectRegion: Point[];
    Direction: string;
    EventID: number;
    GroupID: number;
    Name: string;
    Object: AmcrestObjectDetails;
    PTS: number;
    RuleID: number;
    Track: any[];
    UTC: number;
    UTCMS: number;
}

export enum AmcrestEvent {
    MotionStart = "Code=VideoMotion;action=Start",
    MotionStop = "Code=VideoMotion;action=Stop",
    AudioStart = "Code=AudioMutation;action=Start",
    AudioStop = "Code=AudioMutation;action=Stop",
    TalkInvite = "Code=_DoTalkAction_;action=Invite",
    TalkHangup = "Code=_DoTalkAction_;action=Hangup",
    TalkPulse = "Code=_DoTalkAction_;action=Pulse",
    AlarmIPCStart = "Code=AlarmIPC;action=Start",
    AlarmIPCStop = "Code=AlarmIPC;action=Stop",
    PhoneCallDetectStart = "Code=PhoneCallDetect;action=Start",
    PhoneCallDetectStop = "Code=PhoneCallDetect;action=Stop",
    DahuaTalkInvite = "Code=CallNoAnswered;action=Start",
    DahuaTalkHangup = "Code=PassiveHungup;action=Start",
    DahuaCallDeny = "Code=HungupPhone;action=Pulse",
    DahuaTalkPulse = "Code=_CallNoAnswer_;action=Pulse",
    SmartMotionHuman = "Code=SmartMotionHuman;action=Start",
    SmartMotionVehicle = "Code=Vehicle;action=Start",
    CrossLineDetection = "Code=CrossLineDetection;action=Start",
    CrossRegionDetection = "Code=CrossRegionDetection;action=Start",
}


async function readAmcrestMessage(client: Readable): Promise<string[]> {
    let currentHeaders: string[] = [];
    while (true) {
        const originalLine = await readLine(client);
        const line = originalLine.trim();
        if (!line)
            return currentHeaders;
        // dahua bugs out and sends message without a newline separating the body:
        // Content-Length:39
        // Code=AudioMutation;action=Start;index=0
        if (!line.includes(':')) {
            client.unshift(Buffer.from(originalLine + '\n'));
            return currentHeaders;
        }
        currentHeaders.push(line);
    }
}


export class AmcrestCameraClient {
    credential: AuthFetchCredentialState;

    constructor(public ip: string, username: string, password: string, public console?: Console) {
        this.credential = {
            username,
            password,
        };
    }

    async request(urlOrOptions: string | URL | HttpFetchOptions<Readable>, body?: Readable) {
        const response = await authHttpFetch({
            ...typeof urlOrOptions !== 'string' && !(urlOrOptions instanceof URL) ? urlOrOptions : {
                url: urlOrOptions,
            },
            rejectUnauthorized: false,
            credential: this.credential,
            body,
        });
        return response;
    }

    async reboot() {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/magicBox.cgi?action=reboot`,
            responseType: 'text',
        });
        return response.body;
    }

    async checkTwoWayAudio() {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/devAudioOutput.cgi?action=getCollect`,
            responseType: 'text',
        });
        return response.body.includes('result=1');
    }

    // appAutoStart=true
    // deviceType=IP4M-1041B
    // hardwareVersion=1.00
    // processor=SSC327DE
    // serialNumber=12345
    // updateSerial=IPC-AW46WN-S2
    // updateSerialCloudUpgrade=IPC-AW46WN-.....
    async getDeviceInfo() {
        return getDeviceInfo(this.credential, this.ip);
    }

    async jpegSnapshot(timeout = 10000): Promise<Buffer> {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/snapshot.cgi`,
            timeout,
        });

        return response.body;
    }

    async listenEvents(): Promise<Destroyable> {
        const events = new EventEmitter();
        const url = `http://${this.ip}/cgi-bin/eventManager.cgi?action=attach&codes=[All]`;
        console.log('preparing event listener', url);

        const response = await this.request({
            url,
            responseType: 'readable',
        });
        const stream: IncomingMessage = response.body;
        (events as any).destroy = () => {
            stream.destroy();
            events.removeAllListeners();
        };
        stream.on('close', () => {
            events.emit('close');
        });
        stream.on('end', () => {
            events.emit('end');
        });
        stream.on('error', e => {
            events.emit('error', e);
        });
        stream.socket.setKeepAlive(true);


        const ct = stream.headers['content-type'];
        // make content type parsable as content disposition filename
        const cd = contentType.parse(ct);
        let { boundary } = cd.parameters;
        boundary = `--${boundary}`;
        const boundaryEnd = `${boundary}--`;


        (async () => {
            while (true) {
                let ignore = await readLine(stream);
                ignore = ignore.trim();
                if (!ignore)
                    continue;
                if (ignore === boundaryEnd)
                    continue;
                // dahua bugs out and sends this.
                if (ignore === 'HTTP/1.1 200 OK') {
                    const message = await readAmcrestMessage(stream);
                    this.console.log('ignoring dahua http message', message);
                    message.unshift('');
                    const headers = parseHeaders(message);
                    const body = await readBody(stream, headers);
                    if (body)
                        this.console.log('ignoring dahua http body', body);
                    continue;
                }
                if (ignore !== boundary) {
                    this.console.error('expected boundary but found', ignore);
                    this.console.error(response.headers);
                    throw new Error('expected boundary');
                }

                const message = await readAmcrestMessage(stream);
                events.emit('data', message);
                message.unshift('');
                const headers = parseHeaders(message);
                const body = await readBody(stream, headers);

                const data = body.toString();
                events.emit('data', data);

                const parts = data.split(';');
                let index: string;
                try {
                    for (const part of parts) {
                        if (part.startsWith('index')) {
                            index = part.split('=')[1]?.trim();
                        }
                    }
                }
                catch (e) {
                    this.console.error('error parsing index', data);
                }
                let jsonData: any;
                try {
                    for (const part of parts) {
                        if (part.startsWith('data')) {
                            jsonData = JSON.parse(part.split('=')[1]?.trim());
                        }
                    }
                }
                catch (e) {
                    this.console.error('error parsing data', data);
                }

                for (const event of Object.values(AmcrestEvent)) {
                    if (data.indexOf(event) !== -1) {
                        events.emit('event', event, index, data);

                        if (event === AmcrestEvent.SmartMotionHuman) {
                            events.emit('smart', 'person', jsonData);
                        }
                        else if (event === AmcrestEvent.SmartMotionVehicle) {
                            events.emit('smart', 'car', jsonData);
                        }
                        else if (event === AmcrestEvent.CrossLineDetection || event === AmcrestEvent.CrossRegionDetection) {
                            const eventData: AmcrestEventData = jsonData;
                            if (eventData?.Object?.ObjectType === 'Human') {
                                events.emit('smart', 'person', eventData);
                            }
                            else if (eventData?.Object?.ObjectType === 'Vehicle') {
                                events.emit('smart', 'car', eventData);
                            }
                        }
                    }
                }
            }
        })()
            .catch(() => stream.destroy());
        return events as any as Destroyable;
    }

    async enableContinousRecording(channel: number) {
        for (let i = 0; i < 7; i++) {
            const url = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&Record[${channel - 1}].TimeSection[${i}][0]=1 00:00:00-23:59:59`;
            const response = await this.request({
                url,
                method: 'POST',
                responseType: 'text',
            },);
            this.console.log(response.body);
        }
    }

    async unlock(): Promise<boolean> {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/accessControl.cgi?action=openDoor&channel=1&UserID=101&Type=Remote`,
            responseType: 'text',
        });
        return response.body.includes('OK');
    }

    async lock(): Promise<boolean> {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/accessControl.cgi?action=closeDoor&channel=1&UserID=101&Type=Remote`,
            responseType: 'text',
        });
        return response.body.includes('OK');
    }
}
