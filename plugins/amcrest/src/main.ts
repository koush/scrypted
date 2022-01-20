import sdk, { MediaObject, Camera, ScryptedInterface, Setting, ScryptedDeviceType, Intercom, FFMpegInput, ScryptedMimeTypes, PictureOptions, VideoCameraConfiguration, MediaStreamOptions } from "@scrypted/sdk";
import { Stream, PassThrough } from "stream";
import { AmcrestCameraClient, AmcrestEvent, amcrestHttpsAgent } from "./amcrest-api";
import { RtspSmartCamera, RtspProvider, Destroyable, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { EventEmitter } from "stream";
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput } from '../../../common/src/media-helpers';
import net from 'net';
import { listenZero } from "../../../common/src/listen-cluster";
import { readLength } from "../../../common/src/read-length";

const { mediaManager } = sdk;

const AMCREST_DOORBELL_TYPE = 'Amcrest Doorbell';
const DAHUA_DOORBELL_TYPE = 'Dahua Doorbell';

class AmcrestCamera extends RtspSmartCamera implements VideoCameraConfiguration, Camera, Intercom {
    eventStream: Stream;
    cp: ChildProcess;
    client: AmcrestCameraClient;
    maxExtraStreams: number;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);
        if (this.storage.getItem('amcrestDoorbell') === 'true') {
            this.storage.setItem('doorbellType', AMCREST_DOORBELL_TYPE);
            this.storage.removeItem('amcrestDoorbell');
        }
        
        this.updateDeviceInfo();
    }
    
    async updateDeviceInfo(): Promise<void> {
        var deviceInfo = {};
        
        const deviceParameters = [
            {"action":"getVendor","replace":"vendor=","parameter":"manufacturer"},
            {"action":"getSerialNo","replace":"sn=","parameter":"serialNumber"},
            {"action":"getDeviceType","replace":"type=","parameter":"model"},
            {"action":"getSoftwareVersion","replace":"version=","parameter":"firmware"}
        ];
        
        for (const element of deviceParameters) {
            try {
                const response = await this.getClient().digestAuth.request({
                    url: `http://${this.getHttpAddress()}/cgi-bin/magicBox.cgi?action=${element['action']}`
                });

                const result = String(response.data).replace(element['replace'], "");
                deviceInfo[element['parameter']] = result;
            }
            catch (e) {
                this.console.error('Error getting device parameter', element['action'], e);
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
        const response = await this.getClient().digestAuth.request({
            url: `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=setConfig&Encode[0].MainFormat[${this.getChannelFromMediaStreamOptionsId(options.id)}].Video.BitRate=${bitrate}`
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
                    else if (event === AmcrestEvent.TalkPulse && doorbellType === AMCREST_DOORBELL_TYPE) {
                        clearTimeout(pulseTimeout);
                        pulseTimeout = setTimeout(() => this.binaryState = false, 3000);
                        this.binaryState = true;
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
        return [
            {
                title: 'Doorbell Type',
                choices: [
                    'Not a Doorbell',
                    AMCREST_DOORBELL_TYPE,
                    DAHUA_DOORBELL_TYPE,
                ],
                description: 'If this device is a doorbell, select the appropriate doorbell type.',
                value: this.storage.getItem('doorbellType'),
                key: 'doorbellType',
            },
        ];
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
                description: "The channel number to use for snapshots and video. E.g., 1, 2, etc.",
                placeholder: '1',
                value: this.storage.getItem('rtspChannel'),
            },
        ]
    }

    getRtspChannel() {
        return this.storage.getItem('rtspChannel');
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        let mas = this.maxExtraStreams;
        if (!this.maxExtraStreams) {
            const client = this.getClient();
            try {
                const response = await client.digestAuth.request({
                    url: `http://${this.getHttpAddress()}/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxExtraStream`,
                    responseType: 'text',
                    httpsAgent: amcrestHttpsAgent,
                })
                this.maxExtraStreams = parseInt(response.data.split('=')[1].trim());
                mas = this.maxExtraStreams;
            }
            catch (e) {
                this.console.error('error retrieving max extra streams', e);
            }
        }
        mas = mas || 1;
        const channel = this.getRtspChannel() || '1';
        return [...Array(mas + 1).keys()].map(subtype => this.createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=${channel}&subtype=${subtype}`, subtype));
    }

    async putSetting(key: string, value: string) {
        this.client = undefined;
        this.maxExtraStreams = undefined;

        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === AMCREST_DOORBELL_TYPE || doorbellType === DAHUA_DOORBELL_TYPE;
        super.putSetting(key, value);

        if (isDoorbell)
            provider.updateDevice(this.nativeId, this.name, [...provider.getInterfaces(), ScryptedInterface.BinarySensor, ScryptedInterface.Intercom], ScryptedDeviceType.Doorbell);
        else
            provider.updateDevice(this.nativeId, this.name, provider.getInterfaces());
    }

    async startIntercom(media: MediaObject): Promise<void> {
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
                this.console.error('audio finished with error', e);
            }
            finally {
                passthrough.end();
            }

            this.cp.kill();
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
