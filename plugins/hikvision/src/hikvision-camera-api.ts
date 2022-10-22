import AxiosDigestAuth from '@koush/axios-digest-auth';
import { IncomingMessage } from 'http';
import https from 'https';

export const hikvisionHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export function getChannel(channel: string) {
    return channel || '101';
}

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
    deviceModel: Promise<string>;
    listenerPromise: Promise<IncomingMessage>;

    constructor(public ip: string, username: string, password: string, public console: Console) {
        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async checkDeviceModel(): Promise<string> {
        if (!this.deviceModel) {
            this.deviceModel = new Promise(async (resolve, reject) => {
                try {
                    const response = await this.digestAuth.request({
                        httpsAgent: hikvisionHttpsAgent,
                        method: "GET",
                        responseType: 'text',
                        url: `http://${this.ip}/ISAPI/System/deviceInfo`,
                    });
                    const deviceModel = response.data.match(/>(.*?)<\/model>/)?.[1];
                    resolve(deviceModel);
                } catch (e) {
                    this.console.error('error checking NVR model', e);
                    resolve(undefined);
                }
            });
        }
        return await this.deviceModel;
    }

    async checkIsOldModel() {
        // The old Hikvision DS-7608NI-E2 doesn't support channel capability checks, and the requests cause errors
        const model = await this.checkDeviceModel();
        if (!model)
            return;
        return !!model?.match(/DS-7608NI-E2/);
    }

    async checkStreamSetup(channel: string, isOld: boolean): Promise<HikVisionCameraStreamSetup> {
        if (isOld) {
            this.console.error('NVR is old version.  Defaulting camera capabilities to H.264/AAC');
            return {
                videoCodecType: "H.264",
                audioCodecType: "AAC",
            }
        }

        const response = await this.digestAuth.request({
            httpsAgent: hikvisionHttpsAgent,
            method: "GET",
            responseType: 'text',
            url: `http://${this.ip}/ISAPI/Streaming/channels/${getChannel(channel)}/capabilities`,
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
        const url = `http://${this.ip}/ISAPI/Streaming/channels/${getChannel(channel)}/picture?snapShotImageType=JPEG`

        const response = await this.digestAuth.request({
            httpsAgent: hikvisionHttpsAgent,
            method: "GET",
            responseType: 'arraybuffer',
            url: url,
        });

        return Buffer.from(response.data);
    }

    async listenEvents() {
        // support multiple cameras listening to a single single stream 
        if (!this.listenerPromise) {
            const url = `http://${this.ip}/ISAPI/Event/notification/alertStream`;

            this.listenerPromise = this.digestAuth.request({
                httpsAgent: hikvisionHttpsAgent,
                method: "GET",
                url,
                responseType: 'stream',
            }).then(response => {
                const stream = response.data as IncomingMessage;
                stream.socket.setKeepAlive(true);

                stream.on('data', (buffer: Buffer) => {
                    const data = buffer.toString();
                    for (const event of Object.values(HikVisionCameraEvent)) {
                        if (data.indexOf(event) !== -1) {
                            const cameraNumber = data.match(/<channelID>(.*?)</)?.[1] || data.match(/<dynChannelID>(.*?)</)?.[1];
                            const inactive = data.indexOf('<eventState>inactive</eventState>') !== -1;
                            stream.emit('event', event, cameraNumber, inactive, data);
                        }
                    }
                });
                return stream;
            });
            this.listenerPromise.catch(() => this.listenerPromise = undefined);
            this.listenerPromise.then(stream => {
                stream.on('close', () => this.listenerPromise = undefined);
                stream.on('end', () => this.listenerPromise = undefined);
            });
        }

        return this.listenerPromise;
    }
}
