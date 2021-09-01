import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import { Socket } from 'net';
import { PassThrough, Readable, Stream } from 'stream';
import {Form, Part} from 'multiparty';
import { once } from 'events';

export enum AmcrestEvent {
    MotionStart = "MotionStart",
    MotionStop = "MotionStop",
}

async function readEvent(readable: Readable): Promise<AmcrestEvent|void> {
    const pt = new PassThrough();
    readable.pipe(pt);
    const buffers: Buffer[] = [];
    for await (const buffer of pt) {
        buffers.push(buffer);
        const data = Buffer.concat(buffers).toString();
        if (data.indexOf('Code=VideoMotion;action=Stop') !== -1) {
            return AmcrestEvent.MotionStop;
        }
        else if (data.indexOf('Code=VideoMotion;action=Start') !== -1) {
            return AmcrestEvent.MotionStart;
        }
    }
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

    async* listenForMotionEvents(): AsyncGenerator<AmcrestEvent> {
        const response =  await this.digestAuth.request({
            method: "GET",
            responseType: 'stream',
            url: `http://${this.ip}/cgi-bin/eventManager.cgi?action=attach&codes=[VideoMotion]`,
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
