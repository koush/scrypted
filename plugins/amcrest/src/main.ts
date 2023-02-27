import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';
import { readLength } from "@scrypted/common/src/read-stream";
import sdk, { Camera, DeviceCreatorSettings, DeviceInformation, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, PictureOptions, RequestRecordingStreamOptions, ResponseMediaStreamOptions, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, VideoCameraConfiguration, VideoRecorder } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import { PassThrough, Readable, Stream } from "stream";
import { OnvifIntercom } from "../../onvif/src/onvif-intercom";
import { RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { AmcrestCameraClient, AmcrestEvent, amcrestHttpsAgent } from "./amcrest-api";

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
        this.updateManagementUrl();
    }

    updateManagementUrl() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;
        const info = this.info || {};
        const managementUrl = `http://${ip}`;
        if (info.managementUrl !== managementUrl) {
            info.managementUrl = managementUrl;
            this.info = info;
        }
    }

    getRecordingStreamCurrentTime(recordingStream: MediaObject): Promise<number> {
        throw new Error("Method not implemented.");
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
        return this.createMediaStreamUrl(authedUrl, undefined);
    }

    getRecordingStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
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
        if (!options.id?.startsWith('channel'))
            throw new Error('invalid id');
        const channel = parseInt(this.getRtspChannel()) || 1;
        const formatNumber = parseInt(options.id?.substring('channel'.length)) - 1;
        const format = options.id === 'channel0' ? 'MainFormat' : 'ExtraFormat';
        const encode = `Encode[${channel - 1}].${format}[${formatNumber}]`;
        const params = new URLSearchParams();
        if (options.video?.bitrate) {
            let bitrate = options?.video?.bitrate;
            if (!bitrate)
                return;
            bitrate = Math.round(bitrate / 1000);
            params.set(`${encode}.Video.BitRate`, bitrate.toString());
        }
        if (options.video?.codec === 'h264') {
            params.set(`${encode}.Video.Compression`, 'H.264');
        }
        if (options.video?.codec === 'h265') {
            params.set(`${encode}.Video.Compression`, 'H.265');
        }
        if (options.video?.width && options.video?.height) {
            params.set(`${encode}.Video.resolution`, `${options.video.width}x${options.video.height}`);
        }
        if (options.video?.fps) {
            params.set(`${encode}.Video.FPS`, options.video.fps.toString());
            if (options.video?.idrIntervalMillis) {
                params.set(`${encode}.Video.GOP`, (options.video.fps * options.video?.idrIntervalMillis / 1000).toString());
            }
        }
        if (options.video?.bitrateControl) {
            params.set(`${encode}.Video.BitRateControl`, options.video.bitrateControl === 'variable' ? 'VBR' : 'CBR');
        }

        if (![...params.keys()].length)
            return;

        const response = await this.getClient().digestAuth.request({
            url: `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=setConfig&${params}`
        });
        this.console.log('reconfigure result', response.data);
    }

    getClient() {
        if (!this.client)
            this.client = new AmcrestCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
        return this.client;
    }

    async listenEvents() {
        const client = new AmcrestCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
        const events = await client.listenEvents();
        const doorbellType = this.storage.getItem('doorbellType');
        const callerId = this.storage.getItem('callerID');
        const multipleCallIds = this.storage.getItem('multipleCallIds') === 'true';

        let pulseTimeout: NodeJS.Timeout;

        events.on('event', (event: AmcrestEvent, index: string, payload: string) => {
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
                || event === AmcrestEvent.AlarmIPCStart
                || event === AmcrestEvent.DahuaTalkInvite) {
                if (event === AmcrestEvent.DahuaTalkInvite && payload && multipleCallIds)
                {
                    if (payload.includes(callerId))
                    {
                        this.binaryState = true;
                    }
                } else 
                {
                    this.binaryState = true;
                }
            }
            else if (event === AmcrestEvent.TalkHangup
                || event === AmcrestEvent.PhoneCallDetectStop
                || event === AmcrestEvent.AlarmIPCStop
                || event === AmcrestEvent.DahuaCallDeny
                || event === AmcrestEvent.DahuaTalkHangup) {
                this.binaryState = false;
            }
            else if (event === AmcrestEvent.TalkPulse && doorbellType === AMCREST_DOORBELL_TYPE) {
                if (payload.includes('Invite')) {
                    this.binaryState = true;
                }
                else if (payload.includes('Hangup')) {
                    this.binaryState = false;
                }
            }
            else if (event === AmcrestEvent.DahuaTalkPulse && doorbellType === DAHUA_DOORBELL_TYPE) {
                clearTimeout(pulseTimeout);
                pulseTimeout = setTimeout(() => this.binaryState = false, 3000);
                this.binaryState = true;
            }
        });

        return events;
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

        const choices = [
            'Amcrest',
            'ONVIF',
        ];

        if (!isDoorbell)
            choices.unshift('None');

        twoWayAudio = choices.find(c => c === twoWayAudio);

        if (!twoWayAudio)
            twoWayAudio = isDoorbell ? 'Amcrest' : 'None';
        
        
        if (doorbellType == DAHUA_DOORBELL_TYPE)
        {
            ret.push(
               {
                title: 'Multiple Call Buttons',
                key: 'multipleCallIds',
                description: 'Some Dahua Doorbells integrate multiple Call Buttons for appartment buildings.',
                type: 'boolean',
                value: (this.storage.getItem('multipleCallIds') === 'true').toString(),
               } 
            );
        }

        const multipleCallIds = this.storage.getItem('multipleCallIds');

        if (multipleCallIds)
        {
            ret.push(
                {
                    title: 'Caller ID',
                    key: 'callerID',
                    description: 'Caller ID',
                    type: 'number',
                    value: this.storage.getItem('callerID'),
                }
            )
        }
        

        ret.push(
            {
                title: 'Two Way Audio',
                value: twoWayAudio,
                key: 'twoWayAudio',
                description: 'Amcrest cameras may support both Amcrest and ONVIF two way audio protocols. ONVIF generally performs better when supported.',
                choices,
            },
            // sdcard write causes jitter.
            // {
            //     title: 'Continuous Recording',
            //     key: 'continuousRecording',
            //     description: 'Continuously record onto the Camera SD Card.',
            //     type: 'boolean',
            //     value: (this.storage.getItem('continuousRecording') === 'true').toString(),
            // },
        );

        return ret;
        
    }
    
    
    

    async takeSmartCameraPicture(option?: PictureOptions): Promise<MediaObject> {
        return this.createMediaObject(await this.getClient().jpegSnapshot(), 'image/jpeg');
    }

    async getUrlSettings() {
        return [
            {
                key: 'rtspChannel',
                title: 'Channel Number Override',
                subgroup: 'Advanced',
                description: "The channel number to use for snapshots and video. E.g., 1, 2, etc.",
                placeholder: '1',
                value: this.storage.getItem('rtspChannel'),
            },
            ...await super.getUrlSettings(),
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

                        const videoCodec = findValue(encodeResponse.data, encName, 'Video.Compression')
                            ?.replace('.', '')?.toLowerCase()?.trim();
                        let audioCodec = findValue(encodeResponse.data, encName, 'Audio.Compression')
                            ?.replace('.', '')?.toLowerCase()?.trim();
                        if (audioCodec?.includes('aac'))
                            audioCodec = 'aac';
                        else if (audioCodec.includes('g711a'))
                            audioCodec = 'pcm_alaw';
                        else if (audioCodec.includes('g711u'))
                            audioCodec = 'pcm_ulaw';
                        else if (audioCodec.includes('g711'))
                            audioCodec = 'pcm';

                        if (vso.audio)
                            vso.audio.codec = audioCodec;
                        vso.video.codec = videoCodec;

                        const width = findValue(encodeResponse.data, encName, 'Video.Width');
                        const height = findValue(encodeResponse.data, encName, 'Video.Height');
                        if (width && height) {
                            vso.video.width = parseInt(width);
                            vso.video.height = parseInt(height);
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

        const interfaces = this.provider.getInterfaces();
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
        this.provider.updateDevice(this.nativeId, this.name, interfaces, type);

        this.updateManagementUrl();
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
        const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

        const args = ffmpegInput.inputArguments.slice();
        args.unshift('-hide_banner');

        args.push(
            "-vn",
            '-acodec', 'aac',
            '-f', 'adts',
            'pipe:3',
        );

        this.console.log('ffmpeg intercom', args);

        const ffmpeg = await mediaManager.getFFmpegPath();
        this.cp = child_process.spawn(ffmpeg, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.cp.on('exit', () => this.cp = undefined);
        ffmpegLogInitialOutput(this.console, this.cp);
        const socket = this.cp.stdio[3] as Readable;

        (async () => {
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
        })();
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


    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        const httpAddress = `${settings.ip}:${settings.httpPort || 80}`;
        let info: DeviceInformation = {};

        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate === 'true';
        if (!skipValidate) {
            try {
                const api = new AmcrestCameraClient(httpAddress, username, password, this.console);
                const deviceInfo = await api.getDeviceInfo();

                settings.newCamera = deviceInfo.deviceType;
                info.model = deviceInfo.deviceType;
                info.serialNumber = deviceInfo.serialNumber;
            }
            catch (e) {
                this.console.error('Error adding Amcrest camera', e);
                throw e;
            }
        }
        settings.newCamera ||= 'Hikvision Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as AmcrestCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.setIPAddress(settings.ip?.toString());
        device.setHttpPortOverride(settings.httpPort?.toString());
        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.2.222',
            },
            {
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80',
                placeholder: '80',
            },
            {
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }

    createCamera(nativeId: string) {
        return new AmcrestCamera(nativeId, this);
    }
}

export default AmcrestProvider;
