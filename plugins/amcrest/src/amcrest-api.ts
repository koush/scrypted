import AxiosDigestAuth from '@koush/axios-digest-auth';
import { Readable } from 'stream';
import https from 'https';

export enum AmcrestEvent {
    MotionStart = "Code=VideoMotion;action=Start",
    MotionStop = "Code=VideoMotion;action=Stop",
    AudioStart = "Code=AudioMutation;action=Start",
    AudioStop = "Code=AudioMutation;action=Stop",
    TalkInvite = "Code=_DoTalkAction_;action=Invite",
    TalkHangup = "Code=_DoTalkAction_;action=Hangup",
}

export class AmcrestCameraClient {
    digestAuth: AxiosDigestAuth;

    constructor(public ip: string, username: string, password: string, public console?: Console) {
        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async jpegSnapshot(): Promise<Buffer> {
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        const response = await this.digestAuth.request({
            httpsAgent,
            method: "GET",
            responseType: 'arraybuffer',
            url: `http://${this.ip}/cgi-bin/snapshot.cgi`,
        });

        return Buffer.from(response.data);
    }

    async listenEvents() {
        const url = `http://${this.ip}/cgi-bin/eventManager.cgi?action=attach&codes=[All]`;
        console.log('preparing event listener', url);

        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        const response = await this.digestAuth.request({
            httpsAgent,
            method: "GET",
            responseType: 'stream',
            url,
        });
        const stream = response.data as Readable;

        stream.on('data', (buffer: Buffer) => {
            const data = buffer.toString();
            this.console?.log('event', data);
            for (const event of Object.values(AmcrestEvent)) {
                if (data.indexOf(event) !== -1) {
                    stream.emit('event', event);
                }
            }
        });

        return stream;
    }
}
