import { once } from 'events';
import { EventEmitter, PassThrough, Readable } from 'stream';
import { Form } from 'multiparty';
import AxiosDigestAuth from '@mhoc/axios-digest-auth';

export enum HikVisionCameraEvent {
    MotionDetected = "<eventType>VMD</eventType>",
    VideoLoss = "<eventType>videoloss</eventType>",
}


export interface HikVisionCameraStreamSetup {
    videoCodecType: string;
    audioCodecType: string;
}

export class HikVisionCameraAPI {
    digestAuth: AxiosDigestAuth;

    constructor(public ip: string, username: string, password: string) {
        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async checkStreamSetup(): Promise<HikVisionCameraStreamSetup> {
        const response = await this.digestAuth.request({
            method: "GET",
            responseType: 'text',
            url: `http://${this.ip}/ISAPI/Streaming/channels/101/capabilities`,
        });

        // this is bad:
        // <videoCodecType opt="H.264,H.265">H.265</videoCodecType>
        const vcodec = response.data.match(/>(.*?)<\/videoCodecType>/);
        const acodec = response.data.match(/>(.*?)<\/audioCompressionType>/);

        return {
            videoCodecType: vcodec?.[1],
            audioCodecType: acodec?.[1],
        }
    }


    async jpegSnapshot(channel: string): Promise<Buffer> {
        const url = channel
            ? `http://${this.ip}/ISAPI/Streaming/channels/${channel}01/picture?snapShotImageType=JPEG`
            : `http://${this.ip}/ISAPI/Streaming/channels/101/picture?snapShotImageType=JPEG`

        const response = await this.digestAuth.request({
            method: "GET",
            responseType: 'arraybuffer',
            url: url,
        });

        return Buffer.from(response.data);
    }

    async listenEvents(channel?: string) {
        const response = await this.digestAuth.request({
            method: "GET",
            url: `http://${this.ip}/ISAPI/Event/notification/alertStream`,
            responseType: 'stream',
        });
        const stream = response.data as Readable;

        stream.on('data', (buffer: Buffer) => {
            const data = buffer.toString();
            for (const event of Object.values(HikVisionCameraEvent)) {
                if (data.indexOf(event) !== -1) {
                    if (channel && data.indexOf(`<channelID>${channel}</channelID>`) === -1)
                        continue;
                    stream.emit('event', event);
                }
            }
        });

        return stream;
    }
}
