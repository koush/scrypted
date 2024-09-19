import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { readLine } from '@scrypted/common/src/read-stream';
import { parseHeaders, readBody } from '@scrypted/common/src/rtsp-server';
import contentType from 'content-type';
import { IncomingMessage } from 'http';
import { EventEmitter, Readable } from 'stream';
import { createRtspMediaStreamOptions, Destroyable, UrlMediaStreamOptions } from '../../rtsp/src/rtsp';
import { getDeviceInfo } from './probe';
import { MediaStreamConfiguration, MediaStreamOptions, Point } from '@scrypted/sdk';

export interface AmcrestObjectDetails {
    Action: string;
    BoundingBox: Point;
    Center: Point;
    Confidence: number;
    LowerBodyColor: [number, number, number, number];
    MainColor: [number, number, number, number];
    ObjectID: number;
    ObjectType: string;
    RelativeID: number;
    Speed: number;
}

export interface AmcrestEventData {
    Action: string;
    Class: string;
    CountInGroup: number;
    DetectRegion: Point[];
    Direction: string;
    EventID: number;
    GroupID: number;
    Name: string;
    Object: AmcrestObjectDetails;
    PTS: number;
    RuleID: number;
    Track: any[];
    UTC: number;
    UTCMS: number;
}

export enum AmcrestEvent {
    MotionStart = "Code=VideoMotion;action=Start",
    MotionStop = "Code=VideoMotion;action=Stop",
    MotionInfo = "Code=VideoMotionInfo;action=State",
    AudioStart = "Code=AudioMutation;action=Start",
    AudioStop = "Code=AudioMutation;action=Stop",
    TalkInvite = "Code=_DoTalkAction_;action=Invite",
    TalkHangup = "Code=_DoTalkAction_;action=Hangup",
    TalkPulse = "Code=_DoTalkAction_;action=Pulse",
    AlarmIPCStart = "Code=AlarmIPC;action=Start",
    AlarmIPCStop = "Code=AlarmIPC;action=Stop",
    PhoneCallDetectStart = "Code=PhoneCallDetect;action=Start",
    PhoneCallDetectStop = "Code=PhoneCallDetect;action=Stop",
    DahuaTalkInvite = "Code=CallNoAnswered;action=Start",
    DahuaTalkHangup = "Code=PassiveHungup;action=Start",
    DahuaCallDeny = "Code=HungupPhone;action=Pulse",
    DahuaTalkPulse = "Code=_CallNoAnswer_;action=Pulse",
    FaceDetection = "Code=FaceDetection;action=Start",
    SmartMotionHuman = "Code=SmartMotionHuman;action=Start",
    SmartMotionVehicle = "Code=Vehicle;action=Start",
    CrossLineDetection = "Code=CrossLineDetection;action=Start",
    CrossRegionDetection = "Code=CrossRegionDetection;action=Start",
}


async function readAmcrestMessage(client: Readable): Promise<string[]> {
    let currentHeaders: string[] = [];
    while (true) {
        const originalLine = await readLine(client);
        const line = originalLine.trim();
        if (!line)
            return currentHeaders;
        // dahua bugs out and sends message without a newline separating the body:
        // Content-Length:39
        // Code=AudioMutation;action=Start;index=0
        if (!line.includes(':')) {
            client.unshift(Buffer.from(originalLine + '\n'));
            return currentHeaders;
        }
        currentHeaders.push(line);
    }
}

function findValue(blob: string, prefix: string, key: string) {
    const lines = blob.split('\n');
    const value = lines.find(line => line.startsWith(`${prefix}.${key}`));
    if (!value)
        return;

    const parts = value.split('=');
    return parts[1];
}

function fromAmcrestAudioCodec(audioCodec: string) {
    audioCodec = audioCodec?.trim();
    if (audioCodec === 'AAC')
        return 'aac';
    if (audioCodec === 'G.711A')
        return 'pcm_alaw';
    if (audioCodec === 'G.711Mu')
        return 'pcm_mulaw';
}

function toAmcrestAudioCodec(audioCodec: string) {
    if (audioCodec === 'aac')
        return 'AAC';
    if (audioCodec === 'pcm_alaw')
        return 'G.711A';
    if (audioCodec === 'pcm_mulaw')
        return 'G.711Mu';
}

function fromAmcrestVideoCodec(videoCodec: string) {
    videoCodec = videoCodec?.trim();
    if (videoCodec === 'H.264')
        videoCodec = 'h264';
    else if (videoCodec === 'H.265')
        videoCodec = 'h265';
    return videoCodec;
}

const amcrestResolutions = {
    "1080P": [1920, 1080],
    "720P": [1280, 720],
    "D1": [704, 480],
    "HD1": [352, 480],
    "BCIF": [704, 240],
    "2CIF": [704, 240],
    "CIF": [352, 240],
    "QCIF": [176, 120],
    "NHD": [640, 360],
    "VGA": [640, 480],
    "QVGA": [320, 240]
};

function fromAmcrestResolution(resolution: string) {
    const named = amcrestResolutions[resolution];
    if (named)
        return named;
    const parts = resolution.split('x');
    return [parseInt(parts[0]), parseInt(parts[1])];
}

export class AmcrestCameraClient {
    credential: AuthFetchCredentialState;

    constructor(public ip: string, username: string, password: string, public console?: Console) {
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
            url: `http://${this.ip}/cgi-bin/magicBox.cgi?action=reboot`,
            responseType: 'text',
        });
        return response.body;
    }

    async checkTwoWayAudio() {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/devAudioOutput.cgi?action=getCollect`,
            responseType: 'text',
        });
        return response.body.includes('result=1');
    }

    // appAutoStart=true
    // deviceType=IP4M-1041B
    // hardwareVersion=1.00
    // processor=SSC327DE
    // serialNumber=12345
    // updateSerial=IPC-AW46WN-S2
    // updateSerialCloudUpgrade=IPC-AW46WN-.....
    async getDeviceInfo() {
        return getDeviceInfo(this.credential, this.ip);
    }

    async jpegSnapshot(timeout = 10000): Promise<Buffer> {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/snapshot.cgi`,
            timeout,
        });

        return response.body;
    }

    async setWatermark(cameraNumber: number, enable: boolean) {
        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&VideoWidget[${cameraNumber - 1}].PictureTitle.EncodeBlend=${enable}`,
            responseType: 'text',
        });
        return response.body;
    }

    async listenEvents(): Promise<Destroyable> {
        const events = new EventEmitter();
        const url = `http://${this.ip}/cgi-bin/eventManager.cgi?action=attach&codes=[All]`;
        console.log('preparing event listener', url);

        const response = await this.request({
            url,
            responseType: 'readable',
        });
        const stream: IncomingMessage = response.body;
        (events as any).destroy = () => {
            stream.destroy();
            events.removeAllListeners();
        };
        stream.on('close', () => {
            events.emit('close');
        });
        stream.on('end', () => {
            events.emit('end');
        });
        stream.on('error', e => {
            events.emit('error', e);
        });
        stream.socket.setKeepAlive(true);


        const ct = stream.headers['content-type'];
        // make content type parsable as content disposition filename
        const cd = contentType.parse(ct);
        let { boundary } = cd.parameters;
        // amcrest may send "--myboundary" or "-- myboundary" (with a space)
        const altBoundary = `-- ${boundary}`;
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
                // dahua bugs out and sends this.
                if (ignore === 'HTTP/1.1 200 OK') {
                    const message = await readAmcrestMessage(stream);
                    this.console.log('ignoring dahua http message', message);
                    message.unshift('');
                    const headers = parseHeaders(message);
                    const body = await readBody(stream, headers);
                    if (body)
                        this.console.log('ignoring dahua http body', body);
                    continue;
                }
                if (ignore !== boundary && ignore !== altBoundary) {
                    this.console.error('expected boundary but found', ignore);
                    this.console.error(response.headers);
                    throw new Error('expected boundary');
                }

                const message = await readAmcrestMessage(stream);
                events.emit('data', message);
                message.unshift('');
                const headers = parseHeaders(message);
                const body = await readBody(stream, headers);

                const data = body.toString();
                events.emit('data', data);

                const parts = data.split(';');
                let index: string;
                try {
                    for (const part of parts) {
                        if (part.startsWith('index')) {
                            index = part.split('=')[1]?.trim();
                        }
                    }
                }
                catch (e) {
                    this.console.error('error parsing index', data);
                }
                let jsonData: any;
                try {
                    for (const part of parts) {
                        if (part.startsWith('data')) {
                            jsonData = JSON.parse(part.split('=')[1]?.trim());
                        }
                    }
                }
                catch (e) {
                    this.console.error('error parsing data', data);
                }

                for (const event of Object.values(AmcrestEvent)) {
                    if (data.indexOf(event) !== -1) {
                        events.emit('event', event, index, data);

                        if (event === AmcrestEvent.SmartMotionHuman) {
                            events.emit('smart', 'person', jsonData);
                        }
                        else if (event === AmcrestEvent.SmartMotionVehicle) {
                            events.emit('smart', 'car', jsonData);
                        }
                        else if (event === AmcrestEvent.FaceDetection) {
                            events.emit('smart', 'face', jsonData);
                        }
                        else if (event === AmcrestEvent.CrossLineDetection || event === AmcrestEvent.CrossRegionDetection) {
                            const eventData: AmcrestEventData = jsonData;
                            if (eventData?.Object?.ObjectType === 'Human') {
                                events.emit('smart', 'person', eventData);
                            }
                            else if (eventData?.Object?.ObjectType === 'Vehicle') {
                                events.emit('smart', 'car', eventData);
                            }
                        }
                    }
                }
            }
        })()
            .catch(() => stream.destroy());
        return events as any as Destroyable;
    }

    async enableContinousRecording(channel: number) {
        for (let i = 0; i < 7; i++) {
            const url = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&Record[${channel - 1}].TimeSection[${i}][0]=1 00:00:00-23:59:59`;
            const response = await this.request({
                url,
                method: 'POST',
                responseType: 'text',
            },);
            this.console.log(response.body);
        }
    }

    async unlock(): Promise<boolean> {
        const response = await this.request({
            // channel 1? this may fail through nvr.
            url: `http://${this.ip}/cgi-bin/accessControl.cgi?action=openDoor&channel=1&UserID=101&Type=Remote`,
            responseType: 'text',
        });
        return response.body.includes('OK');
    }

    async lock(): Promise<boolean> {
        const response = await this.request({
            // channel 1? this may fail through nvr.
            url: `http://${this.ip}/cgi-bin/accessControl.cgi?action=closeDoor&channel=1&UserID=101&Type=Remote`,
            responseType: 'text',
        });
        return response.body.includes('OK');
    }


    async resetMotionDetection(cameraNumber: number) {
        const params = new URLSearchParams();
        params.set(`MotionDetect[${cameraNumber - 1}].Enable`, 'true');

        // from amcrest docs:
        // basically a 22x18 binary grid.
        // so a full cell block is 4194303.

        // Currently, a region is divided into 18 lines and 22 blocks per line.
        // A bit describes a block in the line.
        // Bit = 1: motion in this block is monitored.
        // Example:
        // MotionDetect [0].Region [0] = 4194303 (0x3FFFFF): the 22 blocks in
        // channel 0 line 0 is monitored.
        // MotionDetect [0].Region [1] =0: the 22 blocks in channel 0 line 1 is
        // not monitored.
        // MotionDetect [0].Region [17] = 3: the left two blocks in the last line o
        // channel 0 is monitored.

        // there are 4 configurable motion windows, will use the first one, index 0.
        // each window is 18 lines, 22 blocks per line.

        // not sure what this first line is.

        // table.MotionDetect[0].Level=3
        // table.MotionDetect[0].MotionDetectWindow[0].Id=0
        // table.MotionDetect[0].MotionDetectWindow[0].Name=Region1
        // table.MotionDetect[0].MotionDetectWindow[0].Region[0]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[1]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[2]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[3]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[4]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[5]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[6]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[7]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[8]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[9]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[10]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[11]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[12]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[13]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[14]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[15]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[16]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Region[17]=4194303
        // table.MotionDetect[0].MotionDetectWindow[0].Sensitive=60
        // table.MotionDetect[0].MotionDetectWindow[0].Threshold=5

        // doesn't seem to be able to be renamed.
        params.set(`MotionDetect[${cameraNumber - 1}].MotionDetectWindow[0].Name`, 'Scrypted');

        for (let i = 0; i < 18; i++) {
            params.set(`MotionDetect[${cameraNumber - 1}].MotionDetectWindow[0].Region[${i}]`, '4194303');
        }

        params.set(`MotionDetect[${cameraNumber - 1}].MotionDetectWindow[0].Sensitive`, '60');
        params.set(`MotionDetect[${cameraNumber - 1}].MotionDetectWindow[0].Threshold`, '5');

        const response = await this.request({
            url: `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&${params}`,
            responseType: 'text',
        });
        this.console.log('reset motion result', response.body);
    }

    async configureCodecs(cameraNumber: number, options: MediaStreamConfiguration) {
        if (!options.id?.startsWith('channel'))
            throw new Error('invalid id');

        const capsResponse = await this.request({
            url: `http://${this.ip}/cgi-bin/encode.cgi?action=getConfigCaps&channel=${cameraNumber}`,
            responseType: 'text',
        });

        this.console.log(capsResponse.body);

        const formatNumber = Math.max(0, parseInt(options.id?.substring('channel'.length)) - 1);
        const format = options.id === 'channel0' ? 'MainFormat' : 'ExtraFormat';
        const encode = `Encode[${cameraNumber - 1}].${format}[${formatNumber}]`;
        const params = new URLSearchParams();
        if (options.video?.bitrate) {
            let bitrate = options?.video?.bitrate;
            bitrate = Math.round(bitrate / 1000);
            params.set(`${encode}.Video.BitRate`, bitrate.toString());
        }
        if (options.video?.codec === 'h264') {
            params.set(`${encode}.Video.Compression`, 'H.264');
            params.set(`${encode}.VideoEnable`, 'true');
        }
        if (options.video?.profile) {
            let profile = 'Main';
            if (options.video.profile === 'high')
                profile = 'High';
            else if (options.video.profile === 'baseline')
                profile = 'Baseline';
            params.set(`${encode}.Video.Profile`, profile);

        }
        if (options.video?.codec === 'h265') {
            params.set(`${encode}.Video.Compression`, 'H.265');
        }
        if (options.video?.width && options.video?.height) {
            params.set(`${encode}.Video.resolution`, `${options.video.width}x${options.video.height}`);
        }
        if (options.video?.fps) {
            params.set(`${encode}.Video.FPS`, options.video.fps.toString());
        }
        if (options.video?.keyframeInterval) {
            params.set(`${encode}.Video.GOP`, options.video?.keyframeInterval.toString());
        }
        if (options.video?.bitrateControl) {
            params.set(`${encode}.Video.BitRateControl`, options.video.bitrateControl === 'constant' ? 'CBR' : 'VBR');
        }

        if (options.audio?.codec) {
            params.set(`${encode}.Audio.Compression`, toAmcrestAudioCodec(options.audio.codec));
            params.set(`${encode}.AudioEnable`, 'true');
        }

        // nothing else audio related seems configurable.

        if ([...params.keys()].length) {
            const response = await this.request({
                url: `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&${params}`,
                responseType: 'text',
            });
            this.console.log('reconfigure result', response.body);
        }

        const caps = `caps[${cameraNumber - 1}].${format}[${formatNumber}]`;
        const singleCaps = `caps.${format}[${formatNumber}]`;

        const findCaps = (key: string) => {
            const found = findValue(capsResponse.body, caps, key);
            if (found)
                return found;
            // ad410 doesnt return a camera number if accessed directly
            if (cameraNumber - 1 === 0)
                return findValue(capsResponse.body, singleCaps, key);
        }

        const resolutions = findCaps('Video.ResolutionTypes').split(',').map(fromAmcrestResolution);
        const bitrates = findCaps('Video.BitRateOptions').split(',').map(s => parseInt(s) * 1000);
        const fpsMax = parseInt(findCaps('Video.FPSMax'));
        const vso: MediaStreamConfiguration = {
            id: options.id,
            video: {},
        };
        vso.video.resolutions = resolutions;
        vso.video.bitrateRange = [bitrates[0], bitrates[bitrates.length - 1]];
        vso.video.fpsRange = [1, fpsMax];
        return vso;
    }

    async getCodecs(cameraNumber: number): Promise<UrlMediaStreamOptions[]> {
        const masResponse = await this.request({
            url: `http://${this.ip}/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxExtraStream`,
            responseType: 'text',
        });
        const mas = masResponse.body.split('=')[1].trim();

        // amcrest reports more streams than are acually available in its responses,
        // so checking the max extra streams prevents usage of invalid streams.
        const maxExtraStreams = parseInt(mas) || 1;
        const vsos = [...Array(maxExtraStreams + 1).keys()].map(subtype => createRtspMediaStreamOptions(undefined, subtype));

        const encodeResponse = await this.request({
            url: `http://${this.ip}/cgi-bin/configManager.cgi?action=getConfig&name=Encode`,
            responseType: 'text',
        });
        this.console.log(encodeResponse.body);

        for (let i = 0; i < vsos.length; i++) {
            const vso = vsos[i];
            let encName: string;
            if (i === 0) {
                encName = `table.Encode[${cameraNumber - 1}].MainFormat[0]`;
            }
            else {
                encName = `table.Encode[${cameraNumber - 1}].ExtraFormat[${i - 1}]`;
            }

            const videoCodec = fromAmcrestVideoCodec(findValue(encodeResponse.body, encName, 'Video.Compression'));
            const audioCodec = fromAmcrestAudioCodec(findValue(encodeResponse.body, encName, 'Audio.Compression'));

            if (vso.audio)
                vso.audio.codec = audioCodec;
            vso.video.codec = videoCodec;

            const width = findValue(encodeResponse.body, encName, 'Video.Width');
            const height = findValue(encodeResponse.body, encName, 'Video.Height');
            if (width && height) {
                vso.video.width = parseInt(width);
                vso.video.height = parseInt(height);
            }

            const videoEnable = findValue(encodeResponse.body, encName, 'VideoEnable');
            if (videoEnable?.trim() === 'false') {
                this.console.warn('Video stream is disabled and should likely be enabled:', encName);
                continue;
            }

            const encodeOptions = findValue(encodeResponse.body, encName, 'Video.BitRate');
            if (!encodeOptions)
                continue;

            vso.video.bitrate = parseInt(encodeOptions) * 1000;
        }

        return vsos;
    }
}
