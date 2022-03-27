import sdk, { MediaObject, Camera, ScryptedInterface, Setting, ScryptedDeviceType, Intercom, FFMpegInput, ScryptedMimeTypes, PictureOptions, VideoCameraConfiguration, MediaStreamOptions, VideoRecorder, RequestRecordingStreamOptions } from "@scrypted/sdk";
import { Stream, PassThrough } from "stream";
import { AmcrestCameraClient, AmcrestEvent, amcrestHttpsAgent } from "./amcrest-api";
import { RtspSmartCamera, RtspProvider, Destroyable, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { EventEmitter } from "stream";
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';
import net from 'net';
import { listenZero } from "@scrypted/common/src/listen-cluster";
import { readLength } from "@scrypted/common/src/read-stream";
import { OnvifIntercom } from "../../onvif/src/onvif-intercom";

const { mediaManager } = sdk;

const AMCREST_DOORBELL_TYPE = 'Amcrest Doorbell';
const DAHUA_DOORBELL_TYPE = 'Dahua Doorbell';

function findValue(blob: string, prefix: string, key: string) {
    const lines = blob.split('\n');
    const value = lines.find(line => line.startsWith(`${prefix}.${key}`));
    if (!value)
        return;

    const parts = value.split('=');
    return parts[1];
}

class AmcrestCamera extends RtspSmartCamera implements VideoCameraConfiguration, Camera, Intercom, VideoRecorder {
    eventStream: Stream;
    cp: ChildProcess;
    client: AmcrestCameraClient;
    videoStreamOptions: Promise<UrlMediaStreamOptions[]>;
    onvifIntercom = new OnvifIntercom(this);

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);
        if (this.storage.getItem('amcrestDoorbell') === 'true') {
            this.storage.setItem('doorbellType', AMCREST_DOORBELL_TYPE);
            this.storage.removeItem('amcrestDoorbell');
        }

        this.updateDeviceInfo();
    }

    getRecordingStreamThumbnail(time: number): Promise<MediaObject> {
        throw new Error("Method not implemented.");
    }

    async getRecordingStream(options: RequestRecordingStreamOptions): Promise<MediaObject> {
        // ffplay 'rtsp://user:password@192.168.2.87/cam/playback?channel=1&starttime=2022_03_12_21_00_00'
        const startTime = new Date(options.startTime);
        const month = (startTime.getMonth() + 1).toString().padStart(2, '0');
        const date = startTime.getDate().toString().padStart(2, '0');
        const year = startTime.getFullYear();
        const hours = startTime.getHours().toString().padStart(2, '0');
        const minutes = startTime.getMinutes().toString().padStart(2, '0');
        const seconds = startTime.getSeconds().toString().padStart(2, '0');;

        const url = `rtsp://${this.getRtspAddress()}/cam/playback?channel=1&starttime=${year}_${month}_${date}_${hours}_${minutes}_${seconds}`;
        const authedUrl = this.addRtspCredentials(url);
        return this.createFfmpegMediaObject(authedUrl, undefined);
    }

    getRecordingStreamOptions(): Promise<MediaStreamOptions[]> {
        return this.getVideoStreamOptions();
    }

    async updateDeviceInfo(): Promise<void> {
        if (this.info)
            return;
        const deviceInfo = {};

        const deviceParameters = [
            { action: "getVendor", replace: "vendor=", parameter: "manufacturer" },
            { action: "getSerialNo", replace: "sn=", parameter: "serialNumber" },
            { action: "getDeviceType", replace: "type=", parameter: "model" },
            { action: "getSoftwareVersion", replace: "version=", parameter: "firmware" }
        ];

        for (const element of deviceParameters) {
            try {
                const response = await this.getClient().digestAuth.request({
                    url: `http://${this.getHttpAddress()}/cgi-bin/magicBox.cgi?action=${element.action}`
                });

                const result = String(response.data).replace(element.replace, "").trim();
                deviceInfo[element.parameter] = result;
            }
            catch (e) {
                this.console.error('Error getting device parameter', element.action, e);
            }
        }

        this.info = deviceInfo;
    }

    async setVideoStreamOptions(options: MediaStreamOptions): Promise<void> {
        let bitrate = options?.video?.bitrate;
        if (!bitrate)
            return;
        bitrate = Math.round(bitrate / 1000);
        // what is Encode[0]? Is that the camera number?
        const channel = parseInt(this.getRtspChannel()) || 1;
        const format = options.id === 'channel0' ? 'MainFormat' : 'ExtraFormat';
        const response = await this.getClient().digestAuth.request({
            url: `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=setConfig&Encode[${channel - 1}].${format}[0].Video.BitRate=${bitrate}`
        });
        this.console.log('reconfigure result', response.data);
    }

    getClient() {
        if (!this.client)
            this.client = new AmcrestCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
        return this.client;
    }

    listenEvents() {
        const ret = new EventEmitter() as (EventEmitter & Destroyable);
        ret.destroy = () => {
        };
        (async () => {
            try {
                const client = new AmcrestCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
                const events = await client.listenEvents();
                const doorbellType = this.storage.getItem('doorbellType');

                ret.destroy = () => {
                    events.removeAllListeners();
                    events.destroy();
                };

                let pulseTimeout: NodeJS.Timeout;

                events.on('close', () => ret.emit('error', new Error('close')));
                events.on('error', e => ret.emit('error', e));
                events.on('data', (data: Buffer) => {
                    if (this.storage.getItem('debug'))
                        this.console.log('event', data.toString());
                });
                events.on('event', (event: AmcrestEvent, index: string) => {
                    const channelNumber = this.getRtspChannel();
                    if (channelNumber) {
                        const idx = parseInt(index) + 1;
                        if (idx.toString() !== channelNumber)
                            return;
                    }
                    if (event === AmcrestEvent.MotionStart) {
                        this.motionDetected = true;
                    }
                    else if (event === AmcrestEvent.MotionStop) {
                        this.motionDetected = false;
                    }
                    else if (event === AmcrestEvent.AudioStart) {
                        this.audioDetected = true;
                    }
                    else if (event === AmcrestEvent.AudioStop) {
                        this.audioDetected = false;
                    }
                    else if (event === AmcrestEvent.TalkInvite
                        || event === AmcrestEvent.PhoneCallDetectStart
                        || event === AmcrestEvent.AlarmIPCStart || event === AmcrestEvent.DahuaTalkInvite) {
                        this.binaryState = true;
                    }
                    else if (event === AmcrestEvent.TalkHangup
                        || event === AmcrestEvent.PhoneCallDetectStop
                        || event === AmcrestEvent.AlarmIPCStop || event === AmcrestEvent.DahuaTalkHangup) {
                        this.binaryState = false;
                    }
                    else if (event === AmcrestEvent.DahuaTalkPulse && doorbellType === DAHUA_DOORBELL_TYPE) {
                        clearTimeout(pulseTimeout);
                        pulseTimeout = setTimeout(() => this.binaryState = false, 3000);
                        this.binaryState = true;
                    }
                })
            }
            catch (e) {
                ret.emit('error', e);
            }
        })();
        return ret;
    }

    async getOtherSettings(): Promise<Setting[]> {
        const ret = await super.getOtherSettings();
        ret.push(
            {
                title: 'Doorbell Type',
                choices: [
                    'Not a Doorbell',
                    AMCREST_DOORBELL_TYPE,
                    DAHUA_DOORBELL_TYPE,
                ],
                description: 'If this device is a doorbell, select the appropriate doorbell type.',
                value: this.storage.getItem('doorbellType') || 'Not a Doorbell',
                key: 'doorbellType',
            },
        );

        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === AMCREST_DOORBELL_TYPE || doorbellType === DAHUA_DOORBELL_TYPE;

        let twoWayAudio = this.storage.getItem('twoWayAudio');
        if (twoWayAudio === 'true')
            twoWayAudio = 'Amcrest';

        const choices = [
            'Amcrest',
            'ONVIF',
        ];

        if (!isDoorbell)
            choices.unshift('None');

        ret.push(
            {
                title: 'Two Way Audio',
                value: twoWayAudio,
                key: 'twoWayAudio',
                description: 'Amcrest cameras may support both Amcrest and ONVIF two way audio protocols. ONVIF generally performs better when supported.',
                choices,
            },
            {
                title: 'Continuous Recording',
                key: 'continuousRecording',
                description: 'Continuously record onto the Camera SD Card.',
                type: 'boolean',
                value: (this.storage.getItem('continuousRecording') === 'true').toString(),
            },
        );

        return ret;
    }

    async takeSmartCameraPicture(option?: PictureOptions): Promise<MediaObject> {
        return mediaManager.createMediaObject(await this.getClient().jpegSnapshot(), 'image/jpeg');
    }

    async getUrlSettings() {
        return [
            ...await super.getUrlSettings(),
            {
                key: 'rtspChannel',
                title: 'Channel Number Override',
                group: 'Advanced',
                description: "The channel number to use for snapshots and video. E.g., 1, 2, etc.",
                placeholder: '1',
                value: this.storage.getItem('rtspChannel'),
            },
        ]
    }

    getRtspChannel() {
        return this.storage.getItem('rtspChannel');
    }


    createRtspMediaStreamOptions(url: string, index: number) {
        const ret = super.createRtspMediaStreamOptions(url, index);
        ret.tool = 'scrypted';
        return ret;
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        const client = this.getClient();

        if (!this.videoStreamOptions) {
            this.videoStreamOptions = (async () => {
                let mas: string;
                try {
                    const response = await client.digestAuth.request({
                        url: `http://${this.getHttpAddress()}/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxExtraStream`,
                        responseType: 'text',
                        httpsAgent: amcrestHttpsAgent,
                    })
                    mas = response.data.split('=')[1].trim();
                    this.storage.setItem('maxExtraStreams', mas.toString());
                }
                catch (e) {
                    this.console.error('error retrieving max extra streams', e);
                    mas = this.storage.getItem('maxExtraStreams');
                }

                const maxExtraStreams = parseInt(mas) || 1;
                const channel = parseInt(this.getRtspChannel()) || 1;
                const vsos = [...Array(maxExtraStreams + 1).keys()].map(subtype => this.createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=${channel}&subtype=${subtype}`, subtype));

                try {
                    const capResponse = await client.digestAuth.request({
                        url: `http://${this.getHttpAddress()}/cgi-bin/encode.cgi?action=getConfigCaps&channel=0`,
                        responseType: 'text',
                        httpsAgent: amcrestHttpsAgent,
                    });
                    this.console.log(capResponse.data);
                    const encodeResponse = await client.digestAuth.request({
                        url: `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=getConfig&name=Encode`,
                        responseType: 'text',
                        httpsAgent: amcrestHttpsAgent,
                    });
                    this.console.log(encodeResponse.data);

                    for (let i = 0; i < vsos.length; i++) {
                        const vso = vsos[i];
                        let capName: string;
                        let encName: string;
                        if (i === 0) {
                            capName = `caps[${channel - 1}].MainFormat[0]`;
                            encName = `table.Encode[${channel - 1}].MainFormat[0]`;
                        }
                        else {
                            capName = `caps[${channel - 1}].ExtraFormat[${i - 1}]`;
                            encName = `table.Encode[${channel - 1}].ExtraFormat[${i - 1}]`;
                        }

                        const bitrateOptions = findValue(capResponse.data, capName, 'Video.BitRateOptions');
                        if (!bitrateOptions)
                            continue;

                        const encodeOptions = findValue(encodeResponse.data, encName, 'Video.BitRate');
                        if (!encodeOptions)
                            continue;

                        const [min, max] = bitrateOptions.split(',');
                        if (!min || !max)
                            continue;
                        vso.video.bitrate = parseInt(encodeOptions) * 1000;
                        vso.video.maxBitrate = parseInt(max) * 1000;
                        vso.video.minBitrate = parseInt(min) * 1000;
                    }
                }
                catch (e) {
                    this.console.error('error retrieving stream configurations', e);
                }

                return vsos;
            })();
        }

        return this.videoStreamOptions;
    }

    async putSetting(key: string, value: string) {
        if (key === 'continuousRecording') {
            if (value === 'true') {
                try {
                    await this.getClient().enableContinousRecording(parseInt(this.getRtspChannel()) || 1);
                    this.storage.setItem('continuousRecording', 'true');
                }
                catch (e) {
                    this.log.a('There was an error enabling continuous recording.');
                    this.console.error('There was an error enabling continuous recording.', e);
                }
            }
            else {
                this.storage.removeItem('continuousRecording');
            }
        }

        this.client = undefined;
        this.videoStreamOptions = undefined;

        super.putSetting(key, value);
        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === AMCREST_DOORBELL_TYPE || doorbellType === DAHUA_DOORBELL_TYPE;
        // true is the legacy value before onvif was added.
        const twoWayAudio = this.storage.getItem('twoWayAudio') === 'true'
            || this.storage.getItem('twoWayAudio') === 'ONVIF'
            || this.storage.getItem('twoWayAudio') === 'Amcrest';

        const interfaces = provider.getInterfaces();
        let type: ScryptedDeviceType = undefined;
        if (isDoorbell) {
            type = ScryptedDeviceType.Doorbell;
            interfaces.push(ScryptedInterface.BinarySensor)
        }
        if (isDoorbell || twoWayAudio) {
            interfaces.push(ScryptedInterface.Intercom);
        }
        const continuousRecording = this.storage.getItem('continuousRecording') === 'true';
        if (continuousRecording)
            interfaces.push(ScryptedInterface.VideoRecorder);
        provider.updateDevice(this.nativeId, this.name, interfaces, type);
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (this.storage.getItem('twoWayAudio') === 'ONVIF') {
            const options = await this.getConstructedVideoStreamOptions();
            const stream = options[0];
            const url = new URL(stream.url);
            // amcrest onvif requires this proto query parameter, or onvif two way
            // will not activate.
            url.searchParams.set('proto', 'Onvif');
            this.onvifIntercom.url = url.toString();
            return this.onvifIntercom.startIntercom(media);
        }

        // not sure if this all works, since i don't actually have a doorbell.
        // good luck!
        const channel = this.getRtspChannel() || '1';

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFMpegInput;

        const args = ffmpegInput.inputArguments.slice();
        args.unshift('-hide_banner');

        const server = new net.Server(async (socket) => {
            server.close();

            const url = `http://${this.getHttpAddress()}/cgi-bin/audio.cgi?action=postAudio&httptype=singlepart&channel=${channel}`;
            this.console.log('posting audio data to', url);

            // seems the dahua doorbells preferred 1024 chunks. should investigate adts
            // parsing and sending multipart chunks instead.
            const passthrough = new PassThrough();
            this.getClient().digestAuth.request({
                method: 'POST',
                url,
                headers: {
                    'Content-Type': 'Audio/AAC',
                    'Content-Length': '9999999'
                },
                httpsAgent: amcrestHttpsAgent,
                data: passthrough,
            });

            try {
                while (true) {
                    const data = await readLength(socket, 1024);
                    passthrough.push(data);
                }
            }
            catch (e) {
            }
            finally {
                this.console.log('audio finished');
                passthrough.end();
            }

            this.stopIntercom();
        });
        const port = await listenZero(server)

        args.push(
            "-vn",
            '-acodec', 'libfdk_aac',
            '-f', 'adts',
            `tcp://127.0.0.1:${port}`,
        );

        this.console.log('ffmpeg intercom', args);

        const ffmpeg = await mediaManager.getFFmpegPath();
        this.cp = child_process.spawn(ffmpeg, args);
        this.cp.on('exit', () => this.cp = undefined);
        ffmpegLogInitialOutput(this.console, this.cp);
    }

    async stopIntercom(): Promise<void> {
        if (this.storage.getItem('twoWayAudio') === 'ONVIF') {
            return this.onvifIntercom.stopIntercom();
        }

        this.cp?.kill();
        this.cp = undefined;
    }

    showRtspUrlOverride() {
        return false;
    }
}

class AmcrestProvider extends RtspProvider {
    getAdditionalInterfaces() {
        return [
            ScryptedInterface.VideoCameraConfiguration,
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
        ];
    }

    createCamera(nativeId: string) {
        return new AmcrestCamera(nativeId, this);
    }
}

const provider = new AmcrestProvider();

export default provider;
