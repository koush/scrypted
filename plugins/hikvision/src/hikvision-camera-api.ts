import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { readLine } from '@scrypted/common/src/read-stream';
import { parseHeaders, readBody, readMessage } from '@scrypted/common/src/rtsp-server';
import { MediaStreamConfiguration, MediaStreamOptions, PanTiltZoomCommand } from "@scrypted/sdk";
import contentType from 'content-type';
import { IncomingMessage } from 'http';
import { EventEmitter, Readable } from 'stream';
import xml2js from 'xml2js';
import { Destroyable } from '../../rtsp/src/rtsp';
import { CapabiltiesResponse, PtzCapabilitiesRoot } from './hikvision-api-capabilities';
import { HikvisionAPI, HikvisionCameraStreamSetup } from "./hikvision-api-channels";
import { ChannelResponse, ChannelsResponse, SupplementLightRoot } from './hikvision-xml-types';
import { getDeviceInfo } from './probe';
import { PtzPresetsRoot, TextOverlayRoot, VideoOverlayRoot } from './hikvision-overlay';
import { sleep } from '@scrypted/common/src/sleep';

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

// convert thees to ffmpeg codecs
// G.722.1,G.711ulaw,G.711alaw,MP2L2,G.726,PCM,MP3
function fromHikvisionAudioCodec(codec: string) {
    if (codec === 'G.711ulaw')
        return 'pcm_mulaw';
    if (codec === 'G.711alaw')
        return 'pcm_alaw';
    if (codec === 'MP3')
        return 'mp3';
}

function toHikvisionAudioCodec(codec: string) {
    if (codec === 'pcm_mulaw')
        return 'G.711ulaw';
    if (codec === 'pcm_alaw')
        return 'G.711alaw';
    if (codec === 'mp3')
        return 'MP3';
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
        // The old Hikvision NVRs don't support channel capability checks, and the requests cause errors
        const oldModels = [
            /DS-76098NI-E2/,
            /ERI-K104-P4/
        ];
        const model = await this.checkDeviceModel();
        if (!model)
            return;
        return !!oldModels.find(oldModel => model?.match(oldModel));
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

    async configureCodecs(camNumber: string, channelNumber: string, options: MediaStreamOptions): Promise<MediaStreamConfiguration> {
        const cameraChannel = `${camNumber}${channelNumber}`;

        const response = await this.request({
            url: `http://${this.ip}/ISAPI/Streaming/channels/${cameraChannel}`,
            responseType: 'text',
        });
        const channel: ChannelResponse = await xml2js.parseStringPromise(response.body);
        const sc = channel.StreamingChannel;
        const vc = sc.Video[0];
        // may not be any audio
        const ac = sc.Audio?.[0];

        const { video: videoOptions, audio: audioOptions } = options;

        if (videoOptions?.codec) {
            let videoCodecType: string;
            switch (videoOptions.codec) {
                case 'h264':
                    videoCodecType = 'H.264';
                    break;
                case 'h265':
                    videoCodecType = 'H.265';
                    break;
            }
            if (videoCodecType) {
                vc.videoCodecType = [videoCodecType];
                vc.SmartCodec = [{
                    enabled: ['false'],
                }];
                vc.SVC = [{
                    enabled: ['false'],
                }];
            }
        }

        if (videoOptions?.keyframeInterval)
            vc.GovLength = [videoOptions.keyframeInterval.toString()];

        if (videoOptions?.profile) {
            let profile: string;
            switch (videoOptions.profile) {
                case 'baseline':
                    profile = 'Baseline';
                    break;
                case 'main':
                    profile = 'Main';
                    break;
                case 'high':
                    profile = 'High';
                    break;
            }
            if (profile) {
                vc.H264Profile = [profile];
                vc.H265Profile = [profile];
            }
        }

        if (videoOptions?.width && videoOptions?.height) {
            vc.videoResolutionWidth = [videoOptions?.width.toString()];
            vc.videoResolutionHeight = [videoOptions?.height.toString()];
        }


        // can't be set by hikvision. But see if it is settable and doesn't match to direct user.
        if (videoOptions?.bitrateControl && vc.videoQualityControlType?.[0]) {
            const constant = videoOptions?.bitrateControl === 'constant';
            if ((vc.videoQualityControlType[0] === 'CBR' && !constant) || (vc.videoQualityControlType[0] === 'VBR' && constant))
                throw new Error(options.id + ': The camera video Bitrate Type must be manually set to ' + videoOptions?.bitrateControl + ' in the camera web admin.');
        }

        if (videoOptions?.bitrateControl) {
            if (videoOptions?.bitrateControl === 'constant')
                vc.videoQualityControlType = ['CBR'];
            else if (videoOptions?.bitrateControl === 'variable')
                vc.videoQualityControlType = ['VBR'];
        }

        if (videoOptions?.bitrate) {
            const br = Math.round(videoOptions?.bitrate / 1000);
            vc.vbrUpperCap = [br.toString()];
            vc.constantBitRate = [br.toString()];
        }

        if (videoOptions?.fps) {
            // fps is scaled by 100.
            const fps = videoOptions.fps * 100;
            vc.maxFrameRate = [fps.toString()];
            // not sure if this is necessary.
            const gov = parseInt(vc.GovLength[0]);
            vc.keyFrameInterval = [(gov / videoOptions.fps * 100).toString()];
        }

        if (audioOptions?.codec && ac) {
            ac.audioCompressionType = [toHikvisionAudioCodec(options.audio.codec)];
            ac.enabled = ['true'];
        }

        const builder = new xml2js.Builder();
        const put = builder.buildObject(sc);

        const putChannelsResponse = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Streaming/channels/${cameraChannel}`,
            responseType: 'text',
            body: put,
            headers: {
                'Content-Type': 'application/xml',
            }
        });
        this.console.log(putChannelsResponse.body);

        const capsResponse = await this.request({
            url: `http://${this.ip}/ISAPI/Streaming/channels/${cameraChannel}/capabilities`,
            responseType: 'text',
        });
        this.console.log(capsResponse.body);

        const capabilities: CapabiltiesResponse = await xml2js.parseStringPromise(capsResponse.body);
        const v = capabilities.StreamingChannel.Video[0];
        const vso: MediaStreamConfiguration = {
            id: options.id,
            video: {},
        }
        vso.video.bitrateRange = [parseInt(v.vbrUpperCap[0].$.min) * 1000, parseInt(v.vbrUpperCap[0].$.max) * 1000];
        // fps is scaled by 100.
        const fpsRange = v.maxFrameRate[0].$.opt.split(',').map(fps => parseInt(fps) / 100);
        vso.video.fpsRange = [Math.min(...fpsRange), Math.max(...fpsRange)];

        vso.video.bitrateControls = ['constant', 'variable'];
        vso.video.keyframeIntervalRange = [parseInt(v.GovLength[0].$.min), parseInt(v.GovLength[0].$.max)];
        const videoResolutionWidths = v.videoResolutionWidth[0].$.opt.split(',').map(w => parseInt(w));
        const videoResolutionHeights = v.videoResolutionHeight[0].$.opt.split(',').map(h => parseInt(h));
        vso.video.resolutions = videoResolutionWidths.map((w, i) => ([w, videoResolutionHeights[i]]));

        return vso;
    }

    async getCodecs(camNumber: string) {
        const defaultMap = new Map<string, MediaStreamOptions>();
        defaultMap.set(camNumber + '01', undefined);
        defaultMap.set(camNumber + '02', undefined);

        try {
            const response = await this.request({
                url: `http://${this.ip}/ISAPI/Streaming/channels`,
                responseType: 'text',
            });
            const xml = response.body;
            const parsedXml: ChannelsResponse = await xml2js.parseStringPromise(xml);

            const vsos: MediaStreamOptions[] = [];
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
                vsos.push(vso);
            }

            return vsos;
        }
        catch (e) {
            this.console.error('error retrieving channel ids', e);
            return [...defaultMap.values()];
        }
    }

    async getOverlay() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/1/overlays`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body) as VideoOverlayRoot;

        return { json, xml: response.body };
    }

    async getOverlayText(overlayId: string) {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}//ISAPI/System/Video/inputs/channels/1/overlays/text/${overlayId}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body) as TextOverlayRoot;

        return { json, xml: response.body };
    }

    async updateOverlayText(overlayId: string, entry: TextOverlayRoot) {
        const builder = new xml2js.Builder();
        const xml = builder.buildObject(entry);

        await this.request({
            method: 'PUT',
            url: `http://${this.ip}//ISAPI/System/Video/inputs/channels/1/overlays/text/${overlayId}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml
        });
    }

    async getSupplementLight(): Promise<{ json: SupplementLightRoot | any; xml: string }> {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Image/channels/1/supplementLight/capabilities`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const xml = response.body;
        const json = await xml2js.parseStringPromise(xml, {
            explicitArray: false,
            mergeAttrs: true,
        });
        return { json, xml };
    }

    async setSupplementLight(params: { on?: boolean, brightness?: number, mode?: 'auto' | 'manual' }): Promise<void> {
        const { json } = await this.getSupplementLight();

        if (json.ResponseStatus) {
            throw new Error("Supplemental light is not supported on this device.");
        }

        const supp: any = json.SupplementLight;
        if (!supp) {
            throw new Error("Supplemental light configuration not available.");
        }

        if (supp.supplementLightMode && supp.supplementLightMode.opt) {
            const availableModes = supp.supplementLightMode.opt.split(',').map(s => s.trim());
            const selectedMode = params.on
                ? (availableModes.find(mode => mode.toLowerCase() !== 'close') || 'close')
                : 'close';
            supp.supplementLightMode = [selectedMode];
        }

        if (params.mode) {
            supp.mixedLightBrightnessRegulatMode = [params.mode];
        } else if (params.on !== undefined) {
            supp.mixedLightBrightnessRegulatMode = [params.on ? "manual" : "auto"];
        }
        if (params.brightness !== undefined) {
            let brightness = Math.max(0, Math.min(100, params.brightness));
            supp.whiteLightBrightness = [brightness.toString()];
        }

        const builder = new xml2js.Builder({
            headless: true,
            renderOpts: { pretty: false },
        });
        const newXml = builder.buildObject({ SupplementLight: supp });

        await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Image/channels/1/supplementLight`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: newXml,
        });
    }

    async getAlarmCapabilities(): Promise<{ json: any; xml: string }> {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/IO/inputs`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const xml = response.body;
        const json = await xml2js.parseStringPromise(xml, {
            explicitArray: false,
            mergeAttrs: true,
        });
        return { json, xml };
    }

    async getAlarm(port: string): Promise<{ json: any; xml: string }> {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Event/triggers/IO-${port}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const xml = response.body;
        const parsed = await xml2js.parseStringPromise(xml, { explicitArray: true });
        return { json: parsed.EventTrigger, xml };
    }

    async setAlarm(isOn: boolean): Promise<{ json: any; xml: string }> {
        const data = `<IOPortData>
            <enabled>${isOn ? 'true' : 'false'}</enabled>
            <triggering>${isOn ? 'low' : 'high'}</triggering>
        </IOPortData>`;

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/IO/inputs/1`,
            responseType: 'text',
            headers: { 'Content-Type': 'application/xml' },
            body: data
        });

        const xml = response.body;
        let json = {};

        try {
            json = await xml2js.parseStringPromise(xml);
        } catch (error) {
            console.error("Failed to parse XML response for setAlarmInput:", error);
        }

        return { json, xml };
    }

    async getPtzCapabilities(): Promise<{ json: PtzCapabilitiesRoot; xml: string }> {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/capabilities`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const xml = response.body;
        const json = await xml2js.parseStringPromise(xml, {
            explicitArray: false,
            mergeAttrs: true,
        });
        return { json, xml };
    }

    async setPtzPreset(presetId: string) {
        try {
            await this.request({
                method: 'PUT',
                url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/presets/${presetId}/goto`,
                responseType: 'text',
                headers: { 'Content-Type': 'application/xml' },
            });
        } catch (e) {
            this.console.error('Error during setPtzPreset', e);
        }
    }

    async ptzCommand(command: PanTiltZoomCommand) {
        let startCommandData: string;
        let endCommandData: string;

        const movement = 40;
        if (command.preset) {
            await this.setPtzPreset(command.preset);
        } else if (command.pan < 0 || command.pan > 0) {
            startCommandData = `<?xml version: "1.0" encoding="UTF-8"?><PTZData><pan>${command.pan > 0 ? movement : -movement}</pan><tilt>0</tilt></PTZData>`;
            endCommandData = `<?xml version: "1.0" encoding="UTF-8"?><PTZData><pan>0</pan><tilt>0</tilt></PTZData>`;
        } else if (command.tilt < 0 || command.tilt > 0) {
            startCommandData = `<?xml version: "1.0" encoding="UTF-8"?><PTZData><pan>0</pan><tilt>${command.tilt > 0 ? movement : -movement}</tilt></PTZData>`;
            endCommandData = `<?xml version: "1.0" encoding="UTF-8"?><PTZData><pan>0</pan><tilt>0</tilt></PTZData>`;
        } else if (command.zoom < 0 || command.zoom > 0) {
            startCommandData = `<?xml version: "1.0" encoding="UTF-8"?><PTZData><zoom>${command.zoom > 0 ? movement : -movement}</zoom></PTZData>`;
            endCommandData = `<?xml version: "1.0" encoding="UTF-8"?><PTZData><zoom>0</zoom></PTZData>`;
        }

        if (!startCommandData || !endCommandData) {
            return;
        }

        try {
            await this.request({
                method: 'PUT',
                url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/continuous`,
                responseType: 'text',
                headers: { 'Content-Type': 'application/xml' },
                body: startCommandData
            });

            await sleep(500);

            await this.request({
                method: 'PUT',
                url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/continuous`,
                responseType: 'text',
                headers: { 'Content-Type': 'application/xml' },
                body: endCommandData
            });
        } catch (e) {
            this.console.error('Error during PTZ command', e);
        }
    }

    async getPresets() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/presets`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body) as PtzPresetsRoot;

        return { json, xml: response.body };
    }
}