import { HikvisionCameraStreamSetup, HikvisionAPI } from "./hikvision-api-interfaces"
import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { readLine } from '@scrypted/common/src/read-stream';
import { parseHeaders, readBody, readMessage } from '@scrypted/common/src/rtsp-server';
import contentType from 'content-type';
import { IncomingMessage } from 'http';
import { EventEmitter, Readable } from 'stream';
import { Destroyable } from '../../rtsp/src/rtsp';
import { getDeviceInfo } from './probe';
import { sleep } from "@scrypted/common/src/sleep";

export const detectionMap = {
    human: 'person',
    vehicle: 'car',
}

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
    RegionEntrance = "<eventType>regionEntrance</eventType>",
    RegionExit = "<eventType>regionExit</eventType>",
    // <eventType>fielddetection</eventType>
    // <eventState>active</eventState>
    // <eventType>fielddetection</eventType>
    // <eventState>inactive</eventState>
    FieldDetection = "<eventType>fielddetection</eventType>",
}

export class HikvisionCameraAPI implements HikvisionAPI {
    credential: AuthFetchCredentialState;
    deviceModel: Promise<string>;
    listenerPromise: Promise<Destroyable>;

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
            body: typeof urlOrOptions !== 'string' && !(urlOrOptions instanceof URL) ? urlOrOptions?.body : body,
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

    async jpegSnapshot(channel: string, timeout = 10000): Promise<Buffer> {
        const url = `http://${this.ip}/ISAPI/Streaming/channels/${getChannel(channel)}/picture?snapShotImageType=JPEG`

        const response = await this.request({
            url: url,
            timeout,
        });

        return response.body;
    }

    async getVcaResource(channel: string) {
        const response = await this.request({
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/${getChannel(channel)}/VCAResource`,
            responseType: 'text',
        });

        return response.body as string;
    }

    async putVcaResource(channel: string, resource: 'smart' | 'facesnap' | 'close') {
        const current = await this.getVcaResource(channel);
        // no op
        if (current.includes(resource))
            return true;

        const xml = '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
            '<VCAResource version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">\r\n' +
            `<type>${resource}</type>\r\n` +
            '</VCAResource>\r\n';

            const response = await this.request({
                body: xml,
                method: 'PUT',
                url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/${getChannel(channel)}/VCAResource`,
                responseType: 'text',
                headers: {
                    'Content-Type': 'application/xml',
                },
            });

        // need to reboot after this change.
        await this.reboot();
        // return false to indicate that the change will take effect after the reboot.
        return false;
    }

    async listenEvents(): Promise<Destroyable> {
        const events = new EventEmitter();
        (events as any).destroy = () => { };
        // support multiple cameras listening to a single single stream 
        if (!this.listenerPromise) {
            const url = `http://${this.ip}/ISAPI/Event/notification/alertStream`;


            let lastSmartDetection: string;

            this.listenerPromise = this.request({
                url,
                responseType: 'readable',
            }).then(response => {
                const stream: IncomingMessage = response.body;
                (events as any).destroy = () => {
                    stream.destroy();
                    events.removeAllListeners();
                };
                stream.on('close', () => {
                    this.listenerPromise = undefined;
                    events.emit('close');
                });
                stream.on('end', () => {
                    this.listenerPromise = undefined;
                    events.emit('end');
                });
                stream.on('error', e => {
                    this.listenerPromise = undefined;
                    events.emit('error', e);
                });
                stream.socket.setKeepAlive(true);

                const ct = stream.headers['content-type'];
                // make content type parsable as content disposition filename
                const cd = contentType.parse(ct);
                let { boundary } = cd.parameters;
                boundary = `--${boundary}`;
                const boundaryEnd = `${boundary}--`;


                (async () => {
                    while (true) {
                        let ignore = await readLine(stream);
                        ignore = ignore.trim();
                        if (!ignore)
                            continue;
                        if (ignore === boundaryEnd)
                            continue;
                        if (ignore !== boundary
                            // older hikvision nvr send a boundary in the headers, but then use a totally different constant boundary value
                            && ignore != "--boundary") {
                            this.console.error('expected boundary but found', ignore);
                            throw new Error('expected boundary');
                        }

                        const message = await readMessage(stream);
                        events.emit('data', message);
                        message.unshift('');
                        const headers = parseHeaders(message);
                        const body = await readBody(stream, headers);

                        try {
                            if (!headers['content-type'].includes('application/xml') && lastSmartDetection) {
                                if (!headers['content-type']?.startsWith('image/jpeg')) {
                                    continue;
                                }
                                events.emit('smart', lastSmartDetection, body);
                                lastSmartDetection = undefined;
                                continue;
                            }

                        }
                        finally {
                            // is it possible that smart detections are sent without images?
                            // if so, flush this detection.
                            if (lastSmartDetection) {
                                events.emit('smart', lastSmartDetection);
                            }
                        }

                        const data = body.toString();
                        events.emit('data', data);
                        for (const event of Object.values(HikvisionCameraEvent)) {
                            if (data.indexOf(event) !== -1) {
                                const cameraNumber = data.match(/<channelID>(.*?)</)?.[1] || data.match(/<dynChannelID>(.*?)</)?.[1];
                                const inactive = data.indexOf('<eventState>inactive</eventState>') !== -1;
                                events.emit('event', event, cameraNumber, inactive, data);
                                if (event === HikvisionCameraEvent.LineDetection
                                    || event === HikvisionCameraEvent.RegionEntrance
                                    || event === HikvisionCameraEvent.RegionExit
                                    || event === HikvisionCameraEvent.FieldDetection) {
                                    lastSmartDetection = data;
                                }
                            }
                        }
                    }
                })()
                    .catch(() => stream.destroy());
                return events as any as Destroyable;
            });
            this.listenerPromise.catch(() => this.listenerPromise = undefined);
        }

        return this.listenerPromise;
    }
}
