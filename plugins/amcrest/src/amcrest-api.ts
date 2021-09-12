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

async function readEvent(readable: Readable): Promise<AmcrestEvent | void> {
    const pt = new PassThrough();
    readable.pipe(pt);
    const buffers: Buffer[] = [];
    for await (const buffer of pt) {
        buffers.push(buffer);
        const data = Buffer.concat(buffers).toString();
        for (const event of Object.values(AmcrestEvent)) {
            if (data.indexOf(event) !== -1) {
                return event;
            }
        }
    }
    console.log('unhandled', Buffer.concat(buffers).toString());
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

    async* listenEvents(): AsyncGenerator<AmcrestEvent> {
        const response = await this.digestAuth.request({
            method: "GET",
            responseType: 'stream',
            url: `http://${this.ip}/cgi-bin/eventManager.cgi?action=attach&codes=[VideoMotion,AudioMutation]`,
        });

        const stream = response.data;

        const form = new Form();

        try {
            // massage this so the parser doesn't fail on a bad content type
            stream.headers['content-type'] = stream.headers['content-type'].replace('multipart/x-mixed-replace', 'multipart/form-data');
            form.parse(stream);
            while (true) {
                const [part] = await once(form, 'part');
                const event = await readEvent(part);
                if (event)
                    yield event;
            }
        }
        finally {
            stream.destroy();
        }
    }
}
