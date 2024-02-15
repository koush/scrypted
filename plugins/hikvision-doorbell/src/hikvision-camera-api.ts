import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { IncomingMessage } from 'http';
import { Readable, PassThrough } from 'stream';
import { getDeviceInfo } from './probe';
import libip from 'ip';
import xml2js from 'xml2js';
import { MediaStreamOptions } from "@scrypted/sdk";
import { Destroyable } from '../../rtsp/src/rtsp';


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
    endpoint: string;

    constructor(public ip: string, public port: string, username: string, password: string, public console: Console, public storage: Storage) {
        this.credential = {
            username,
            password,
        };
        this.endpoint = libip.isV4Format(ip) ? `${ip}:${port}` : `[${ip}]:${port}`;
    }

    async request(urlOrOptions: string | HttpFetchOptions<Readable>, body?: Readable) {
        const response = await authHttpFetch({
            ...typeof urlOrOptions !== 'string' ? urlOrOptions : {
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
            url: `http://${this.endpoint}/ISAPI/System/reboot`,
            method: "PUT",
            responseType: 'text',
        });

        return response.body;
    }

    async getDeviceInfo() {
        return getDeviceInfo(this.credential, this.endpoint);
    }

    async checkTwoWayAudio() {
        const response = await this.request({
            url: `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels`,
            responseType: 'text',
        });

        return response.body.includes('audioCompressionType');
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
            url: `http://${this.endpoint}/ISAPI/Streaming/channels/${getChannel(channel)}/capabilities`,
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
        const url = `http://${this.endpoint}/ISAPI/Streaming/channels/${getChannel(channel)}/picture?snapShotImageType=JPEG`

        const response = await this.request({
            url: url,
            responseType: 'buffer',
            timeout: 60000,
        });

        return response.body;
    }

    

    async listenEvents(): Promise<Destroyable> {
        // support multiple cameras listening to a single single stream 
        if (!this.listenerPromise) {
            const url = `http://${this.endpoint}/ISAPI/Event/notification/alertStream`;

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


    async getVideoChannels(): Promise<Map<string, MediaStreamOptions>> {

        let xml: string;
        try {
            const response = await this.request({
                url: `http://${this.endpoint}/ISAPI/Streaming/channels`,
                responseType: 'text',
            });
            xml = response.body;
            this.storage.setItem('channels', xml);
        }
        catch (e) {
            xml = this.storage.getItem('channels');
            if (!xml)
                throw e;
        }
        const parsedXml = await xml2js.parseStringPromise(xml);

        const ret = new Map<string, MediaStreamOptions>();
        for (const streamingChannel of parsedXml.StreamingChannelList.StreamingChannel) {
            const [id] = streamingChannel.id;
            const width = parseInt(streamingChannel?.Video?.[0]?.videoResolutionWidth?.[0]) || undefined;
            const height = parseInt(streamingChannel?.Video?.[0]?.videoResolutionHeight?.[0]) || undefined;
            let codec = streamingChannel?.Video?.[0]?.videoCodecType?.[0] as string;
            codec = codec?.toLowerCase()?.replaceAll('.', '');
            const vso: MediaStreamOptions = {
                id,
                video: {
                    width,
                    height,
                    codec,
                }
            }
            ret.set(id, vso);
        }

        return ret;
    }

    async twoWayAudioCodec(channel: string): Promise<string> {

        const parameters = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels`;
        const { body } = await this.request({
            url: parameters,
            responseType: 'text',
        });

        const parsedXml = await xml2js.parseStringPromise(body);
        for (const twoWayChannel of parsedXml.TwoWayAudioChannelList.TwoWayAudioChannel) {
            const [id] = twoWayChannel.id;
            if (id === channel)
                return twoWayChannel?.audioCompressionType?.[0];
        }
    }

    async openTwoWayAudio(channel: string, passthrough: PassThrough) {

        const open = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/open`;
        const { body } = await this.request({
            url: open,
            responseType: 'text',
            method: 'PUT',
        });
        this.console.log('two way audio opened', body);

        const url = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/audioData`;
        this.console.log('posting audio data to', url);

        return this.request({
            url,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Connection': 'keep-alive',
                'Content-Length': '0' // it is important, this leads to send binary nochanked stream
            },
            method: 'PUT'
        }, passthrough);
    }

    async closeTwoWayAudio(channel: string) {

        await this.request({
            url: `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/close`,
            method: 'PUT',
            responseType: 'text',
        });
    }

    rtspUrlFor(endpoint: string, channelId: string, params: string): string {
        return `rtsp://${endpoint}/ISAPI/Streaming/channels/${channelId}/${params}`;
    }

    async openDoor() {
        throw Error("Method not implemented.");
    }

    async closeDoor() {
        throw Error("Method not implemented.");
    }

    async setFakeSip (enabled: boolean, ip: string , port: number) {
        throw Error("Method not implemented.");
    }

}
