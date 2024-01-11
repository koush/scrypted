import { AuthFetchCredentialState, HttpFetchOptions, HttpFetchResponseType, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { IncomingMessage } from 'http';
import { Readable } from 'stream';
import { getDeviceInfo } from './probe';

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
    credential: AuthFetchCredentialState;
    deviceModel: Promise<string>;
    listenerPromise: Promise<IncomingMessage>;

    constructor(public ip: string, username: string, password: string, public console: Console) {
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
            url: `http://${this.ip}/ISAPI/System/reboot`,
            method: "PUT",
            responseType: 'text',
        });

        return response.body;
    }

    async getDeviceInfo() {
        return getDeviceInfo(this.credential, this.ip);
    }

    async checkTwoWayAudio() {
        const response = await this.request({
            url: `http://${this.ip}/ISAPI/System/TwoWayAudio/channels`,
            responseType: 'text',
        });

        return response.body.includes('Speaker');
    }

    async checkDeviceModel(): Promise<string> {
        if (!this.deviceModel) {
            this.deviceModel = this.getDeviceInfo().then(d => d.deviceModel).catch(e => {
                this.console.error('error checking NVR model', e);
                return undefined;
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

        const response = await this.request({
            url: `http://${this.ip}/ISAPI/Streaming/channels/${getChannel(channel)}/capabilities`,
            responseType: 'text',
        });

        // this is bad:
        // <videoCodecType opt="H.264,H.265">H.265</videoCodecType>
        const vcodec = response.body.match(/>(.*?)<\/videoCodecType>/);
        const acodec = response.body.match(/>(.*?)<\/audioCompressionType>/);

        return {
            videoCodecType: vcodec?.[1],
            audioCodecType: acodec?.[1],
        }
    }

    async jpegSnapshot(channel: string): Promise<Buffer> {
        const url = `http://${this.ip}/ISAPI/Streaming/channels/${getChannel(channel)}/picture?snapShotImageType=JPEG`

        const response = await this.request({
            url: url,
            timeout: 60000,
        });

        return response.body;
    }

    async listenEvents() {
        // support multiple cameras listening to a single single stream 
        if (!this.listenerPromise) {
            const url = `http://${this.ip}/ISAPI/Event/notification/alertStream`;

            this.listenerPromise = this.request({
                url,
                responseType: 'readable',
            }).then(response => {
                const stream = response.body;
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
