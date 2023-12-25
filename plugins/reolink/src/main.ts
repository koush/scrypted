import { sleep } from '@scrypted/common/src/sleep';
import sdk, { Camera, DeviceCreatorSettings, DeviceInformation, Intercom, MediaObject, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, PictureOptions, Reboot, ScryptedDeviceType, ScryptedInterface, Setting } from "@scrypted/sdk";
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { EventEmitter } from "stream";
import { Destroyable, RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { OnvifCameraAPI, connectCameraAPI } from './onvif-api';
import { listenEvents } from './onvif-events';
import { OnvifIntercom } from './onvif-intercom';
import { AIState, DevInfo, Enc, ReolinkCameraClient } from './reolink-api';

class ReolinkCamera extends RtspSmartCamera implements Camera, Reboot, Intercom, ObjectDetector {
    client: ReolinkCameraClient;
    onvifClient: OnvifCameraAPI;
    onvifIntercom = new OnvifIntercom(this);
    videoStreamOptions: Promise<UrlMediaStreamOptions[]>;
    motionTimeout: NodeJS.Timeout;

    storageSettings = new StorageSettings(this, {
        doorbell: {
            title: 'Doorbell',
            description: 'This camera is a Reolink Doorbell.',
            type: 'boolean',
        },
        rtmpPort: {
            subgroup: 'Advanced',
            title: 'RTMP Port Override',
            placeholder: '1935',
            type: 'number',
        },
        motionTimeout: {
            group: 'Advanced',
            title: 'Motion Timeout',
            defaultValue: 10,
            type: 'number',
        },
        hasObjectDetector: {
            json: true,
            hide: true,
        }
    });

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.updateDeviceInfo();
        this.updateDevice();
    }

    async getDetectionInput(detectionId: string, eventId?: any): Promise<MediaObject> {
        return;
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        try {
            const ai: AIState = this.storageSettings.values.hasObjectDetector[0]?.value;
            const classes: string[] = [];

            for (const key of Object.keys(ai)) {
                if (key === 'channel')
                    continue;
                const { alarm_state, support } = ai[key];
                if (support)
                    classes.push(key);
            }
            return {
                classes,
            };
        }
        catch (e) {
            return {
                classes: [],
            };
        }
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (!this.onvifIntercom.url) {
            const client = await this.getOnvifClient();
            const streamUrl = await client.getStreamUrl();
            this.onvifIntercom.url = streamUrl;
        }
        return this.onvifIntercom.startIntercom(media);
    }

    stopIntercom(): Promise<void> {
        return this.onvifIntercom.stopIntercom();
    }

    updateDevice() {
        const interfaces = this.provider.getInterfaces();
        let type = ScryptedDeviceType.Camera;
        let name = 'Reolink Camera';
        if (this.storageSettings.values.doorbell) {
            interfaces.push(
                ScryptedInterface.BinarySensor,
                ScryptedInterface.Intercom
            );
            type = ScryptedDeviceType.Doorbell;
            name = 'Reolink Doorbell';
        }
        if (this.storageSettings.values.hasObjectDetector) {
            interfaces.push(ScryptedInterface.ObjectDetector);
        }
        this.provider.updateDevice(this.nativeId, name, interfaces, type);
    }

    async reboot() {
        const client = this.getClient();
        await client.reboot();
    }

    updateDeviceInfo() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;
        const info = this.info || {};
        info.ip = ip;
        info.manufacturer = 'Reolink';
        info.managementUrl = `http://${ip}`;
        this.info = info;
    }

    getClient() {
        if (!this.client)
            this.client = new ReolinkCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.getRtspChannel(), this.console);
        return this.client;
    }


    async getOnvifClient() {
        if (!this.onvifClient)
            this.onvifClient = await this.createOnvifClient();
        return this.onvifClient;
    }

    createOnvifClient() {
        return connectCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console, this.storage.getItem('onvifDoorbellEvent'));
    }

    async listenEvents() {
        let killed = false;
        const client = this.getClient();

        // reolink ai might not trigger motion if objects are detected, weird.
        const startAI = async (ret: Destroyable, triggerMotion: () => void) => {
            let hasSucceeded = false;
            while (!killed) {
                try {
                    const ai = await client.getAiState();
                    ret.emit('data', JSON.stringify(ai.data));

                    const classes: string[] = [];

                    for (const key of Object.keys(ai.value)) {
                        if (key === 'channel')
                            continue;
                        const { alarm_state, support } = ai.value[key];
                        if (support)
                            classes.push(key);
                    }

                    if (!classes.length)
                        return;

                    hasSucceeded = true;
                    if (!this.storageSettings.values.hasObjectDetector) {
                        this.storageSettings.values.hasObjectDetector = ai.data;
                        this.updateDevice();
                    }
                    const od: ObjectsDetected = {
                        timestamp: Date.now(),
                        detections: [],
                    };
                    for (const c of classes) {
                        const { alarm_state } = ai.value[c];
                        if (alarm_state) {
                            od.detections.push({
                                className: c,
                                score: 1,
                            });
                        }
                    }
                    if (od.detections.length) {
                        triggerMotion();
                        sdk.deviceManager.onDeviceEvent(this.nativeId, ScryptedInterface.ObjectDetector, od);
                    }
                }
                catch (e) {
                    if (!hasSucceeded)
                        return;
                    ret.emit('error', e);
                }
                await sleep(1000);
            }
        }

        if (this.storageSettings.values.doorbell) {
            const ret = await listenEvents(this, await this.createOnvifClient(), this.storageSettings.values.motionTimeout * 1000);
            ret.on('close', () => killed = true);
            ret.on('error', () => killed = true);
            startAI(ret, ret.triggerMotion);
            return ret;
        }

        const events = new EventEmitter();
        const ret: Destroyable = {
            on: function (eventName: string | symbol, listener: (...args: any[]) => void): void {
                events.on(eventName, listener);
            },
            destroy: function (): void {
                killed = true;
            },
            emit: function (eventName: string | symbol, ...args: any[]): boolean {
                return events.emit(eventName, ...args);
            }
        };

        const triggerMotion = () => {
            this.motionDetected = true;
            clearTimeout(this.motionTimeout);
            this.motionTimeout = setTimeout(() => this.motionDetected = false, this.storageSettings.values.motionTimeout * 1000);
        };
        (async () => {
            while (!killed) {
                try {
                    const { value, data } = await client.getMotionState();
                    if (value)
                        triggerMotion();
                    ret.emit('data', JSON.stringify(data));
                }
                catch (e) {
                    ret.emit('error', e);
                }
                await sleep(1000);
            }
        })();
        startAI(ret, triggerMotion);
        return ret;
    }

    async takeSmartCameraPicture(option?: PictureOptions): Promise<MediaObject> {
        return this.createMediaObject(await this.getClient().jpegSnapshot(), 'image/jpeg');
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'rtspChannel',
                title: 'Channel Number Override',
                subgroup: 'Advanced',
                description: "The channel number to use for snapshots and video. E.g., 0, 1, 2, etc.",
                placeholder: '0',
                type: 'number',
                value: this.getRtspChannel(),
            },
            ...await super.getUrlSettings(),
        ]
    }

    getRtspChannel() {
        return parseInt(this.storage.getItem('rtspChannel')) || 0;
    }

    createRtspMediaStreamOptions(url: string, index: number) {
        const ret = super.createRtspMediaStreamOptions(url, index);
        ret.tool = 'scrypted';
        return ret;
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        this.videoStreamOptions ||= this.getConstructedVideoStreamOptionsInternal().catch(e => {
            this.constructedVideoStreamOptions = undefined;
            throw e;
        });

        return this.videoStreamOptions;
    }

    async getConstructedVideoStreamOptionsInternal(): Promise<UrlMediaStreamOptions[]> {
        let deviceInfo: DevInfo;
        try {
            const client = this.getClient();
            deviceInfo = await client.getDeviceInfo();
        } catch (e) {
            this.console.error("Unable to gather device information.", e);
        }

        let encoderConfig: Enc;
        try {
            const client = this.getClient();
            encoderConfig = await client.getEncoderConfiguration();
        } catch (e) {
            this.console.error("Codec query failed. Falling back to known defaults.", e);
        }

        const channel = (this.getRtspChannel() + 1).toString().padStart(2, '0');

        const streams: UrlMediaStreamOptions[] = [
            {
                name: '',
                id: 'main.bcs',
                container: 'rtmp',
                video: { width: 2560, height: 1920 },
                url: ''
            },
            {
                name: '',
                id: 'ext.bcs',
                container: 'rtmp',
                video: { width: 896, height: 672 },
                url: ''
            },
            {
                name: '',
                id: 'sub.bcs',
                container: 'rtmp',
                video: { width: 640, height: 480 },
                url: ''
            },
            {
                name: '',
                id: `h264Preview_${channel}_main`,
                container: 'rtsp',
                video: { codec: 'h264', width: 2560, height: 1920 },
                url: ''
            },
            {
                name: '',
                id: `h264Preview_${channel}_sub`,
                container: 'rtsp',
                video: { codec: 'h264', width: 640, height: 480 },
                url: ''
            }
        ];

        if (deviceInfo?.model == "Reolink TrackMix PoE") {
            streams.push({
                name: '',
                id: 'autotrack.bcs',
                container: 'rtmp',
                video: { width: 896, height: 512 },
                url: ''

            })
        }

        for (const stream of streams) {
            var streamUrl;
            if (stream.container === 'rtmp') {
                streamUrl = new URL(`rtmp://${this.getRtmpAddress()}/bcs/channel${this.getRtspChannel()}_${stream.id}`)
                const params = streamUrl.searchParams;
                params.set("channel", this.getRtspChannel().toString())
                params.set("stream", '0')
                params.set("user", this.getUsername())
                params.set("password", this.getPassword())
                stream.url = streamUrl.toString();
                stream.name = `RTMP ${stream.id}`;
            } else if (stream.container === 'rtsp') {
                streamUrl = new URL(`rtsp://${this.getRtspAddress()}/${stream.id}`)
                stream.url = streamUrl.toString();
                stream.name = `RTSP ${stream.id}`;
            }
        }

        if (encoderConfig) {
            const { mainStream } = encoderConfig;
            if (mainStream?.width && mainStream?.height) {
                for (const stream of streams) {
                    if (stream.id === 'main.bcs' || stream.id === `h264Preview_${channel}_main`) {
                        stream.video.width = mainStream.width;
                        stream.video.height = mainStream.height;
                    }
                    // 4k h265 rtmp is seemingly nonfunctional, but rtsp works. swap them so there is a functional stream.
                    if (mainStream.vType === 'h265' || mainStream.vType === 'hevc') {
                        if (stream.id === `h264Preview_${channel}_main`) {
                            this.console.warn('Detected h265. Change the camera configuration to use 2k mode to force h264. https://docs.scrypted.app/camera-preparation.html#h-264-video-codec');
                            stream.video.codec = 'h265';
                            stream.id = `h265Preview_${channel}_main`;
                            stream.name = `RTSP ${stream.id}`;
                            stream.url = `rtsp://${this.getRtspAddress()}/${stream.id}`;
                            // Per Reolink:
                            // https://support.reolink.com/hc/en-us/articles/360007010473-How-to-Live-View-Reolink-Cameras-via-VLC-Media-Player/
                            // Note: the 4k cameras connected with the 4k NVR system will only show a fluent live stream instead of the clear live stream due to the H.264+(h.265) limit.
                        }
                    }
                }
            }
        }

        return streams;

    }

    async putSetting(key: string, value: string) {
        this.client = undefined;
        super.putSetting(key, value);
        this.updateDevice();
        this.updateDeviceInfo();
    }

    showRtspUrlOverride() {
        return false;
    }

    async getRtspPortOverrideSettings(): Promise<Setting[]> {
        return [
            ...await super.getRtspPortOverrideSettings(),
            ...await this.storageSettings.getSettings(),
            {
                key: 'rtmpPort',
                subgroup: 'Advanced',
                title: 'RTMP Port Override',
                placeholder: '1935',
                value: this.storage.getItem('rtmpPort'),
            },
        ];
    }

    getRtmpAddress() {
        return `${this.getIPAddress()}:${this.storage.getItem('rtmpPort') || 1935}`;
    }
}

class ReolinkProider extends RtspProvider {
    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Reboot,
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
        const doorbell = settings.doorbell?.toString();
        const skipValidate = settings.skipValidate?.toString() === 'true';
        const rtspChannel = parseInt(settings.rtspChannel?.toString()) || 0;
        if (!skipValidate) {
            try {
                const api = new ReolinkCameraClient(httpAddress, username, password, rtspChannel, this.console);
                await api.jpegSnapshot();
                // there doesn't seem to be a way to get the actual model number information out of their api.
            }
            catch (e) {
                this.console.error('Error adding Reolink camera', e);
                throw e;
            }
        }
        settings.newCamera ||= 'Reolink Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as ReolinkCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.putSetting('doorbell', doorbell)
        device.setIPAddress(settings.ip?.toString());
        device.putSetting('rtspChannel', settings.rtspChannel?.toString());
        device.setHttpPortOverride(settings.httpPort?.toString());
        device.updateDeviceInfo();
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
                key: 'doorbell',
                title: 'Doorbell',
                description: 'This camera is a Reolink Doorbell.',
                type: 'boolean',
            },
            {
                key: 'rtspChannel',
                title: 'Channel Number Override',
                description: "Optional: The channel number to use for snapshots and video. E.g., 0, 1, 2, etc.",
                placeholder: '0',
                type: 'number',
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
        return new ReolinkCamera(nativeId, this);
    }
}

export default ReolinkProider;
