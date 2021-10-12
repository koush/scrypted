import { once } from 'events';
import { EventEmitter, PassThrough, Readable } from 'stream';
import { Form } from 'multiparty';
import AxiosDigestAuth from '@mhoc/axios-digest-auth';

export enum HikVisionCameraEvent {
    MotionDetected = "<eventType>VMD</eventType>",
    VideoLoss = "<eventType>videoloss</eventType>",
    // <eventType>linedetection</eventType>
    // <eventState>active</eventState>
    // <eventType>linedetection</eventType>
    // <eventState>inactive</eventState>
    LineDetection = "<eventType>linedetection</eventType>",
    // <eventType>fielddetection</eventType>
    // <eventState>active</eventState>
    // <eventType>fielddetection</eventType>
    // <eventState>inactive</eventState>
    FieldDetection = "<eventType>fielddetection</eventType>",
}


export interface HikVisionCameraStreamSetup {
    videoCodecType: string;
    audioCodecType: string;
}

export class HikVisionCameraAPI {
    digestAuth: AxiosDigestAuth;

    constructor(public ip: string, username: string, password: string, public channel: string, public console: Console) {
        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async checkStreamSetup(): Promise<HikVisionCameraStreamSetup> {
        const response = await this.digestAuth.request({
            method: "GET",
            responseType: 'text',
            url: `http://${this.ip}/ISAPI/Streaming/channels/${this.getChannel()}/capabilities`,
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

    getChannel() {
        return this.channel || '101';
    }

    async jpegSnapshot(): Promise<Buffer> {
        const url = `http://${this.ip}/ISAPI/Streaming/channels/${this.getChannel()}/picture?snapShotImageType=JPEG`

        const response = await this.digestAuth.request({
            method: "GET",
            responseType: 'arraybuffer',
            url: url,
        });

        return Buffer.from(response.data);
    }

    async listenEvents() {
        const response = await this.digestAuth.request({
            method: "GET",
            url: `http://${this.ip}/ISAPI/Event/notification/alertStream`,
            responseType: 'stream',
        });
        const stream = response.data as Readable;

        stream.on('data', (buffer: Buffer) => {
            const data = buffer.toString();
            this.console.log(data);
            for (const event of Object.values(HikVisionCameraEvent)) {
                if (data.indexOf(event) !== -1) {
                    const channel = data.match(/<channelID>(.*?)</)?.[1] || data.match(/<dynChannelID>(.*?)</)?.[1];
                    if (this.channel
                        && data.indexOf(`<channelID>${this.channel.substr(0, 1)}</channelID>`) === -1) {
                        continue;
                    }
                    stream.emit('event', event, channel);
                }
            }
        });

        return stream;
    }
}
