import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import { PassThrough, Readable } from 'stream';
import { Form } from 'multiparty';
import { once } from 'events';

export enum AmcrestEvent {
    MotionStart = "Code=VideoMotion;action=Start",
    MotionStop = "Code=VideoMotion;action=Stop",
    AudioStart = "Code=AudioMutation;action=Start",
    AudioStop = "Code=AudioMutation;action=Stop",
}

export class AmcrestCameraClient {
    digestAuth: AxiosDigestAuth;

    constructor(public ip: string, public username: string, public password: string) {

        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async jpegSnapshot(): Promise<Buffer> {
        const response = await this.digestAuth.request({
            method: "GET",
            responseType: 'arraybuffer',
            url: `http://${this.ip}/cgi-bin/snapshot.cgi`,
        });

        return Buffer.from(response.data);
    }

    async listenEvents() {
        const response = await this.digestAuth.request({
            method: "GET",
            responseType: 'stream',
            url: `http://${this.ip}/cgi-bin/eventManager.cgi?action=attach&codes=[VideoMotion,AudioMutation]`,
        });
        const stream = response.data as Readable;

        stream.on('data', (buffer: Buffer) => {
            const data = buffer.toString();
            for (const event of Object.values(AmcrestEvent)) {
                if (data.indexOf(event) !== -1) {
                    stream.emit('event', event);
                }
            }
        });

        return stream;
    }
}
