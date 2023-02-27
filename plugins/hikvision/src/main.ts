import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';
import { readLength } from '@scrypted/common/src/read-stream';
import sdk, { Camera, DeviceCreatorSettings, DeviceInformation, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, VideoStreamOptions } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import { PassThrough, Readable } from "stream";
import { sleep } from "../../../common/src/sleep";
import { OnvifIntercom } from "../../onvif/src/onvif-intercom";
import { RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { getChannel, HikvisionCameraAPI, HikvisionCameraEvent } from "./hikvision-camera-api";
import xml2js from 'xml2js';
import { hikvisionHttpsAgent } from './probe';

const { mediaManager } = sdk;

function channelToCameraNumber(channel: string) {
    if (!channel)
        return;
    return channel.substring(0, channel.length - 2);
}

class HikvisionCamera extends RtspSmartCamera implements Camera, Intercom {
    detectedChannels: Promise<Map<string, MediaStreamOptions>>;
    client: HikvisionCameraAPI;
    onvifIntercom = new OnvifIntercom(this);
    cp: ChildProcess;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.updateDeviceInfo();
    }

    async updateDeviceInfo() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;
        const managementUrl = `http://${ip}`;
        const info: DeviceInformation = {
            ...this.info,
            managementUrl,
            ip,
            manufacturer: 'Hikvision', 
        };
        const client = this.getClient();
        const deviceInfo = await client.getDeviceInfo().catch(() => { });
        if (deviceInfo) {
            info.model = deviceInfo.deviceModel;
            info.mac = deviceInfo.macAddress;
            info.firmware = deviceInfo.firmwareVersion;
            info.serialNumber = deviceInfo.serialNumber;
        }
        this.info = info;
    }

    async listenEvents() {
        let motionTimeout: NodeJS.Timeout;
        const api = (this.provider as HikvisionProvider).createSharedClient(this.getHttpAddress(), this.getUsername(), this.getPassword());
        const events = await api.listenEvents();

        let ignoreCameraNumber: boolean;

        let motionPingsNeeded = parseInt(this.storage.getItem('motionPings')) || 1;
        const motionTimeoutDuration = (parseInt(this.storage.getItem('motionTimeout')) || 10) * 1000;
        let motionPings = 0;
        events.on('event', async (event: HikvisionCameraEvent, cameraNumber: string, inactive: boolean) => {
            if (event === HikvisionCameraEvent.MotionDetected
                || event === HikvisionCameraEvent.LineDetection
                || event === HikvisionCameraEvent.FieldDetection) {

                // check if the camera+channel field is in use, and filter events.
                if (this.getRtspChannel()) {
                    // it is possible to set it up to use a camera number
                    // on an nvr IP (which gives RTSP urls through the NVR), but then use a http port
                    // that gives a filtered event stream from only that camera.
                    // this this case, the camera numbers will not
                    // match as they will be always be "1".
                    // to detect that a camera specific endpoint is being used
                    // can look at the channel ids, and see if that camera number is found.
                    // this is different from the use case where the NVR or camera
                    // is using a port other than 80 (the default).
                    // could add a setting to have the user explicitly denote nvr usage
                    // but that is error prone.
                    const userCameraNumber = this.getCameraNumber();
                    if (ignoreCameraNumber === undefined && this.detectedChannels) {
                        const channelIds = (await this.detectedChannels).keys();
                        ignoreCameraNumber = true;
                        for (const id of channelIds) {
                            if (channelToCameraNumber(id) === userCameraNumber) {
                                ignoreCameraNumber = false;
                                break;
                            }
                        }
                    }

                    if (!ignoreCameraNumber && cameraNumber !== userCameraNumber) {
                        // this.console.error(`### Skipping motion event ${cameraNumber} != ${this.getCameraNumber()}`);
                        return;
                    }
                }

                motionPings++;
                // this.console.log(this.name, 'motion pings', motionPings);

                // this.console.error('### Detected motion, camera: ', cameraNumber);
                this.motionDetected = motionPings >= motionPingsNeeded;
                clearTimeout(motionTimeout);
                // motion seems to be on a 1 second pulse
                motionTimeout = setTimeout(() => {
                    this.motionDetected = false;
                    motionPings = 0;
                }, motionTimeoutDuration);
            }
        })

        return events;
    }

    createClient() {
        return new HikvisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
    }

    getClient() {
        if (!this.client)
            this.client = this.createClient();
        return this.client;
    }

    async takeSmartCameraPicture(): Promise<MediaObject> {
        const api = this.getClient();
        return mediaManager.createMediaObject(await api.jpegSnapshot(this.getRtspChannel()), 'image/jpeg');
    }

    async getRtspUrlSettings(): Promise<Setting[]> {
        const ret = await super.getRtspUrlSettings();

        ret.push(
            {
                subgroup: 'Advanced',
                key: 'rtspUrlParams',
                title: 'RTSP URL Parameters Override',
                description: "Optional: Override the RTSP URL parameters. E.g.: ?transportmode=unicast",
                placeholder: this.getRtspUrlParams(),
                value: this.storage.getItem('rtspUrlParams'),
            },
        );
        return ret;
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            {
                subgroup: 'Advanced',
                key: 'rtspChannel',
                title: 'Channel Number',
                description: "Optional: The channel number to use for snapshots. E.g., 101, 201, etc. The camera portion, e.g., 1, 2, etc, will be used to construct the RTSP stream.",
                placeholder: '101',
                value: this.storage.getItem('rtspChannel'),
            },
            ...await super.getUrlSettings(),
        ]
    }

    getRtspChannel() {
        return this.storage.getItem('rtspChannel');
    }

    getCameraNumber() {
        return channelToCameraNumber(this.getRtspChannel());
    }

    getRtspUrlParams() {
        return this.storage.getItem('rtspUrlParams') || '?transportmode=unicast';
    }

    async isOld() {
        const client = this.getClient();
        let isOld: boolean;
        if (this.storage.getItem('isOld')) {
            isOld = this.storage.getItem('isOld') === 'true';
        }
        else {
            isOld = await client.checkIsOldModel();
            this.storage.setItem('isOld', isOld?.toString());
        }
        return isOld;
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (!this.detectedChannels) {
            const client = this.getClient();
            this.detectedChannels = (async () => {
                const isOld = await this.isOld();

                const defaultMap = new Map<string, MediaStreamOptions>();
                const camNumber = this.getCameraNumber() || '1';
                defaultMap.set(camNumber + '01', undefined);
                defaultMap.set(camNumber + '02', undefined);

                if (isOld) {
                    this.console.error('Old NVR. Defaulting to two camera configuration');
                    return defaultMap;
                } else {
                    try {
                        let xml: string;
                        try {
                            const response = await client.digestAuth.request({
                                httpsAgent: hikvisionHttpsAgent,
                                url: `http://${this.getHttpAddress()}/ISAPI/Streaming/channels`,
                                responseType: 'text',
                            });
                            xml = response.data;
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
                    catch (e) {
                        this.console.error('error retrieving channel ids', e);
                        this.detectedChannels = undefined;
                        return defaultMap;
                    }
                }
            })();
        }
        const detectedChannels = await this.detectedChannels;
        const params = this.getRtspUrlParams() || '?transportmode=unicast';

        // due to being able to override the channel number, and NVR providing per channel port access,
        // do not actually use these channel ids, and just use it to determine the number of channels
        // available for a camera.q
        const ret = [];
        let index = 0;
        const cameraNumber = this.getCameraNumber();
        for (const [id, channel] of detectedChannels.entries()) {
            if (cameraNumber && channelToCameraNumber(id) !== cameraNumber)
                continue;
            const mso = this.createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/ISAPI/Streaming/channels/${id}/${params}`, index++);
            Object.assign(mso.video, channel?.video);
            mso.tool = 'scrypted';
            ret.push(mso);
        }

        return ret;
    }

    showRtspUrlOverride() {
        return false;
    }

    async putSetting(key: string, value: string) {
        this.client = undefined;
        this.detectedChannels = undefined;
        super.putSetting(key, value);

        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === 'true';

        const twoWayAudio = this.storage.getItem('twoWayAudio') === 'true'
            || this.storage.getItem('twoWayAudio') === 'ONVIF'
            || this.storage.getItem('twoWayAudio') === 'Hikvision';

        const interfaces = this.provider.getInterfaces();
        let type: ScryptedDeviceType = undefined;
        if (isDoorbell) {
            type = ScryptedDeviceType.Doorbell;
            interfaces.push(ScryptedInterface.BinarySensor)
        }
        if (isDoorbell || twoWayAudio) {
            interfaces.push(ScryptedInterface.Intercom);
        }

        this.provider.updateDevice(this.nativeId, this.name, interfaces, type);

        this.updateDeviceInfo();
    }

    async getOtherSettings(): Promise<Setting[]> {
        const ret = await super.getOtherSettings();

        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === 'true';

        let twoWayAudio = this.storage.getItem('twoWayAudio');

        const choices = [
            'Hikvision',
            'ONVIF',
        ];

        if (!isDoorbell)
            choices.unshift('None');

        twoWayAudio = choices.find(c => c === twoWayAudio);

        if (!twoWayAudio)
            twoWayAudio = isDoorbell ? 'Hikvision' : 'None';

        ret.unshift(
            {
                subgroup: 'Advanced',
                key: 'motionTimeout',
                title: 'Motion Timeout',
                description: 'Duration to report motion after the last motion ping.',
                value: parseInt(this.storage.getItem('motionTimeout')) || 10,
                type: 'number',
            },
            {
                subgroup: 'Advanced',
                key: 'motionPings',
                title: 'Motion Ping Count',
                description: 'Number of motion pings needed to trigger motion.',
                value: parseInt(this.storage.getItem('motionPings')) || 1,
                type: 'number',
            },
        );

        ret.push(
            {
                title: 'Doorbell',
                type: 'boolean',
                description: 'This device is a Hikvision doorbell.',
                value: isDoorbell,
                key: 'doorbellType',
            },
            {
                title: 'Two Way Audio',
                value: twoWayAudio,
                key: 'twoWayAudio',
                description: 'Hikvision cameras may support both Hikvision and ONVIF two way audio protocols. ONVIF generally performs better when supported.',
                choices,
            },
        );

        return ret;
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

        const channel = this.getRtspChannel() || '1';
        let codec: string;
        let format: string;

        try {
            const parameters = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels`;
            const { data: parametersData } = await this.getClient().digestAuth.request({
                httpsAgent: hikvisionHttpsAgent,
                url: parameters,
            });

            const parsedXml = await xml2js.parseStringPromise(parametersData);
            for (const twoWayChannel of parsedXml.TwoWayAudioChannelList.TwoWayAudioChannel) {
                const [id] = twoWayChannel.id;
                if (id !== channel)
                    continue;
                codec = twoWayChannel?.audioCompressionType?.[0];
            }
        }
        catch (e) {
            this.console.error('Fialure while determining two way audio codec', e);
        }

        if (codec === 'G.711ulaw') {
            codec = 'pcm_mulaw';
            format = 'mulaw'
        }
        else if (codec === 'G.711alaw') {
            codec = 'pcm_alaw';
            format = 'alaw'
        }
        else {
            if (codec) {
                this.console.warn('Unknown codec', codec);
                this.console.warn('Set your audio codec to G.711ulaw.');
            }
            this.console.warn('Using fallback codec pcm_mulaw. This may not be correct.');
            // seems to ship with this as defaults.
            codec = 'pcm_mulaw';
            format = 'mulaw'
        }

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

        const args = ffmpegInput.inputArguments.slice();
        args.unshift('-hide_banner');

        args.push(
            "-vn",
            '-ar', '8000',
            '-ac', '1',
            '-acodec', codec,
            '-f', format,
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
            const passthrough = new PassThrough();

            try {
                const open = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${channel}/open`;
                const { data } = await this.getClient().digestAuth.request({
                    httpsAgent: hikvisionHttpsAgent,
                    method: 'PUT',
                    url: open,
                });
                this.console.log('two way audio opened', data);

                const url = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${channel}/audioData`;
                this.console.log('posting audio data to', url);

                // seems the dahua doorbells preferred 1024 chunks. should investigate adts
                // parsing and sending multipart chunks instead.
                this.getClient().digestAuth.request({
                    httpsAgent: hikvisionHttpsAgent,
                    method: 'PUT',
                    url,
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        // 'Connection': 'close',
                        'Content-Length': '0'
                    },
                    data: passthrough,
                });


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

        const client = this.getClient();
        await client.digestAuth.request({
            httpsAgent: hikvisionHttpsAgent,
            method: 'PUT',
            url: `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${this.getRtspChannel() || '1'}/close`,
        })
    }
}

class HikvisionProvider extends RtspProvider {
    clients: Map<string, HikvisionCameraAPI>;

    constructor() {
        super();
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
        ];
    }

    createSharedClient(address: string, username: string, password: string) {
        if (!this.clients)
            this.clients = new Map();

        const key = `${address}#${username}#${password}`;
        const check = this.clients.get(key);
        if (check)
            return check;
        const client = new HikvisionCameraAPI(address, username, password, this.console);
        this.clients.set(key, client);
        return client;
    }

    createCamera(nativeId: string) {
        return new HikvisionCamera(nativeId, this);
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        const httpAddress = `${settings.ip}:${settings.httpPort || 80}`;
        let info: DeviceInformation = {};

        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate === 'true';
        if (!skipValidate) {
            try {
                const api = new HikvisionCameraAPI(httpAddress, username, password, this.console);
                const deviceInfo = await api.getDeviceInfo();

                settings.newCamera = deviceInfo.deviceName;
                info.model = deviceInfo.deviceModel;
                // info.manufacturer = 'Hikvision';
                info.mac = deviceInfo.macAddress;
                info.firmware = deviceInfo.firmwareVersion;
                info.serialNumber = deviceInfo.serialNumber;
            }
            catch (e) {
                this.console.error('Error adding Hikvision camera', e);
                throw e;
            }
        }
        settings.newCamera ||= 'Hikvision Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as HikvisionCamera;
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
}

export default new HikvisionProvider();
