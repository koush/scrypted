import AxiosDigestAuth from '@koush/axios-digest-auth';
import { Readable } from 'stream';
import https from 'https';
import { IncomingMessage } from 'http';
import { amcrestHttpsAgent, getDeviceInfo } from './probe';

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
}


export class AmcrestCameraClient {
    digestAuth: AxiosDigestAuth;

    constructor(public ip: string, username: string, password: string, public console?: Console) {
        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async reboot() {
        const response = await this.digestAuth.request({
            httpsAgent: amcrestHttpsAgent,
            method: "GET",
            responseType: 'text',
            url: `http://${this.ip}/cgi-bin/magicBox.cgi?action=reboot`,
        });
        return response.data as string;
    }

    async checkTwoWayAudio() {
        const response = await this.digestAuth.request({
            httpsAgent: amcrestHttpsAgent,
            method: "GET",
            responseType: 'text',
            url: `http://${this.ip}/cgi-bin/devAudioOutput.cgi?action=getCollect`,
        });
        return (response.data as string).includes('result=1');
    }

    // appAutoStart=true
    // deviceType=IP4M-1041B
    // hardwareVersion=1.00
    // processor=SSC327DE
    // serialNumber=12345
    // updateSerial=IPC-AW46WN-S2
    // updateSerialCloudUpgrade=IPC-AW46WN-.....
    async getDeviceInfo() {
        return getDeviceInfo(this.digestAuth, this.ip);
    }

    async jpegSnapshot(): Promise<Buffer> {

        const response = await this.digestAuth.request({
            httpsAgent: amcrestHttpsAgent,
            method: "GET",
            responseType: 'arraybuffer',
            url: `http://${this.ip}/cgi-bin/snapshot.cgi`,
            timeout: 60000,
        });

        return Buffer.from(response.data);
    }

    async listenEvents() {
        const url = `http://${this.ip}/cgi-bin/eventManager.cgi?action=attach&codes=[All]`;
        console.log('preparing event listener', url);

        const response = await this.digestAuth.request({
            httpsAgent: amcrestHttpsAgent,
            method: "GET",
            responseType: 'stream',
            url,
        });
        const stream = response.data as IncomingMessage;
        stream.socket.setKeepAlive(true);

        stream.on('data', (buffer: Buffer) => {
            const data = buffer.toString();
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
            // this.console?.log('event', data);
            for (const event of Object.values(AmcrestEvent)) {
                if (data.indexOf(event) !== -1) {
                    stream.emit('event', event, index, data);
                }
            }
        });

        return stream;
    }

    async enableContinousRecording(channel: number) {
        for (let i = 0; i < 7; i++) {
            const url = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&Record[${channel - 1}].TimeSection[${i}][0]=1 00:00:00-23:59:59`;
            const response = await this.digestAuth.request({
                httpsAgent: amcrestHttpsAgent,
                method: "POST",
                url,
            });
            this.console.log(response.data);
        }
    }
}
