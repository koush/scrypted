import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';
import { readLength } from '@scrypted/common/src/read-stream';
import sdk, { Camera, FFmpegInput, Intercom, MediaObject, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import { PassThrough, Readable } from "stream";
import { sleep } from "../../../common/src/sleep";
import { OnvifIntercom } from "../../onvif/src/onvif-intercom";
import { RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { getChannel, HikVisionCameraAPI, HikVisionCameraEvent, hikvisionHttpsAgent } from "./hikvision-camera-api";

const { mediaManager } = sdk;

class HikVisionCamera extends RtspSmartCamera implements Camera, Intercom {
    channelIds: Promise<string[]>;
    client: HikVisionCameraAPI;
    onvifIntercom = new OnvifIntercom(this);
    cp: ChildProcess;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

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

    async listenEvents() {
        let motionTimeout: NodeJS.Timeout;
        const api = (this.provider as HikVisionProvider).createSharedClient(this.getHttpAddress(), this.getUsername(), this.getPassword());
        const events = await api.listenEvents();

        let ignoreCameraNumber: boolean;

        events.on('event', async (event: HikVisionCameraEvent, cameraNumber: string, inactive: boolean) => {
            if (event === HikVisionCameraEvent.MotionDetected
                || event === HikVisionCameraEvent.LineDetection
                || event === HikVisionCameraEvent.FieldDetection) {

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
                    if (ignoreCameraNumber === undefined && this.channelIds) {
                        const channelIds = await this.channelIds;
                        ignoreCameraNumber = true;
                        for (const id of channelIds) {
                            if (id.startsWith(userCameraNumber)) {
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

                // this.console.error('### Detected motion, camera: ', cameraNumber);
                this.motionDetected = true;
                clearTimeout(motionTimeout);
                motionTimeout = setTimeout(() => this.motionDetected = false, inactive ? 5000 : 30000);
            }
        })

        return events;
    }

    createClient() {
        return new HikVisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
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
                group: 'Advanced',
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
                group: 'Advanced',
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
        const channel = this.getRtspChannel();
        // have users with more than 10 cameras. unsure if it is possible
        // to have more than 10 substreams...
        if (channel?.length > 3)
            return channel.substring(0, channel.length - 2);
        return channel?.substring(0, 1) || '1';
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
        if (!this.channelIds) {
            const client = this.getClient();
            this.channelIds = new Promise(async (resolve, reject) => {
                const isOld = await this.isOld();

                if (isOld) {
                    this.console.error('Old NVR. Defaulting to two camera configuration');
                    const camNumber = this.getCameraNumber() || '1';
                    resolve([camNumber + '01', camNumber + '02']);
                } else try {
                    const response = await client.digestAuth.request({
                        httpsAgent: hikvisionHttpsAgent,
                        url: `http://${this.getHttpAddress()}/ISAPI/Streaming/channels`,
                        responseType: 'text',
                    });
                    const xml: string = response.data;
                    const matches = xml.matchAll(/<id>(.*?)<\/id>/g);
                    const ids = [];
                    for (const m of matches) {
                        ids.push(m[1]);
                    }
                    resolve(ids);
                }
                catch (e) {
                    const cameraNumber = this.getCameraNumber() || '1';
                    this.console.error('error retrieving channel ids', e);
                    resolve([cameraNumber + '01', cameraNumber + '02']);
                    this.channelIds = undefined;
                }
            })
        }
        const channelIds = await this.channelIds;
        const params = this.getRtspUrlParams() || '?transportmode=unicast';

        // due to being able to override the channel number, and NVR providing per channel port access,
        // do not actually use these channel ids, and just use it to determine the number of channels
        // available for a camera.
        const ret = [];
        const cameraNumber = this.getCameraNumber() || '1';
        for (let index = 0; index < channelIds.length; index++) {
            const channel = (index + 1).toString().padStart(2, '0');
            const mso = this.createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/ISAPI/Streaming/channels/${cameraNumber}${channel}/${params}`, index);
            ret.push(mso);
        }

        return ret;
    }

    showRtspUrlOverride() {
        return false;
    }

    async putSetting(key: string, value: string) {
        this.client = undefined;
        this.channelIds = undefined;
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

        this.updateManagementUrl();
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

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

        const args = ffmpegInput.inputArguments.slice();
        args.unshift('-hide_banner');

        args.push(
            "-vn",
            '-ar', '8000',
            '-ac', '1',
            '-acodec', 'pcm_mulaw',
            '-f', 'mulaw',
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
                const open = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${this.getRtspChannel() || '1'}/open`;
                const {data} = await this.getClient().digestAuth.request({
                    httpsAgent: hikvisionHttpsAgent,
                    method: 'PUT',
                    url: open,
                });
                this.console.log('two way audio opened', data);

                const url = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${this.getRtspChannel() || '1'}/audioData`;
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

class HikVisionProvider extends RtspProvider {
    clients: Map<string, HikVisionCameraAPI>;

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
        const client = new HikVisionCameraAPI(address, username, password, this.console);
        this.clients.set(key, client);
        return client;
    }

    createCamera(nativeId: string) {
        return new HikVisionCamera(nativeId, this);
    }
}

export default new HikVisionProvider();
