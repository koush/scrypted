import AxiosDigestAuth from '@koush/axios-digest-auth';
import { IncomingMessage } from 'http';
import { getDeviceInfo, hikvisionHttpsAgent } from './probe';

export function getChannel(channel: string) {
    return channel || '101';
}

export enum HikvisionCameraEvent {
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


export interface HikvisionCameraStreamSetup {
    videoCodecType: string;
    audioCodecType: string;
}

export class HikvisionCameraAPI {
    digestAuth: AxiosDigestAuth;
    deviceModel: Promise<string>;
    listenerPromise: Promise<IncomingMessage>;

    constructor(public ip: string, username: string, password: string, public console: Console) {
        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async reboot() {
        const response = await this.digestAuth.request({
            httpsAgent: hikvisionHttpsAgent,
            method: "PUT",
            responseType: 'text',
            url: `http://${this.ip}/ISAPI/System/reboot`,
        });

        return response.data;
    }

    async getDeviceInfo() {
        return getDeviceInfo(this.digestAuth, this.ip);
    }

    async checkTwoWayAudio() {
        const response = await this.digestAuth.request({
            httpsAgent: hikvisionHttpsAgent,
            method: "GET",
            responseType: 'text',
            url: `http://${this.ip}/ISAPI/System/TwoWayAudio/channels`,
        });

        return (response.data as string).includes('Speaker');
    }

    async checkDeviceModel(): Promise<string> {
        if (!this.deviceModel) {
            this.deviceModel = this.getDeviceInfo().then(d => d.deviceModel).catch(e => {
                this.console.error('error checking NVR model', e);
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

    async checkStreamSetup(channel: string, isOld: boolean): Promise<HikvisionCameraStreamSetup> {
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
            timeout: 60000,
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
                    for (const event of Object.values(HikvisionCameraEvent)) {
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
