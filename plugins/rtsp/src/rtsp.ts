import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, MediaStreamOptions, ScryptedInterface, FFMpegInput, Camera, PictureOptions, SettingValue } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import { recommendRebroadcast } from "./recommend";
import AxiosDigestAuth from '@koush/axios-digest-auth';
import https from 'https';
import { randomBytes } from "crypto";

const { log, deviceManager, mediaManager } = sdk;

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

export interface RtspMediaStreamOptions extends MediaStreamOptions {
    url: string;
}

export class RtspCamera extends ScryptedDeviceBase implements Camera, VideoCamera, Settings {
    snapshotAuth: AxiosDigestAuth;

    constructor(nativeId: string, public provider: RtspProvider) {
        super(nativeId);
    }

    getSnapshotUrl() {
        return this.storage.getItem('snapshotUrl');
    }

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        const snapshotUrl = this.getSnapshotUrl();
        if (!snapshotUrl) {
            throw new Error('RTSP Camera has no snapshot URL');
        }

        if (!this.snapshotAuth) {
            this.snapshotAuth = new AxiosDigestAuth({
                username: this.getUsername(),
                password: this.getPassword(),
            });
        }

        const response = await this.snapshotAuth.request({
            httpsAgent,
            method: "GET",
            responseType: 'arraybuffer',
            url: snapshotUrl,
        });

        return mediaManager.createMediaObject(Buffer.from(response.data), response.headers['Content-Type'] || 'image/jpeg');
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    createRtspMediaStreamOptions(url: string, index: number) {
        return {
            id: `channel${index}`,
            name: `Channel ${index + 1}`,
            url,
            video: {
            },
            audio: this.isAudioDisabled() ? null : {},
        };
    }

    async getVideoStreamOptions(): Promise<RtspMediaStreamOptions[]> {
        const vsos = (await this.getVideoStreamOptions()).filter(vso => this.isChannelEnabled(vso.id));
        return vsos;
    }

    getRtspVideoStreamOptions(): RtspMediaStreamOptions[] {
        let urls: string[] = [];
        try {
            urls = JSON.parse(this.storage.getItem('urls'));
        }
        catch (e) {
            const url = this.storage.getItem('url');
            if (url) {
                urls.push(url);
                this.storage.setItem('urls', JSON.stringify(urls));
                this.storage.removeItem('url');
            }
        }

        // filter out empty strings.
        const ret = urls.filter(url => !!url).map((url, index) => this.createRtspMediaStreamOptions(url, index));

        if (!ret.length)
            return;
        return ret;
    }

    isAudioDisabled() {
        return this.storage.getItem('noAudio') === 'true';
    }

    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const vsos = (await this.getVideoStreamOptions()).filter(vso => this.isChannelEnabled(vso.id));
        const vso = vsos.find(s => s.id === options?.id) || vsos[0];

        const url = new URL(vso.url);
        this.console.log('rtsp stream url', url.toString());
        const username = this.storage.getItem("username");
        const password = this.storage.getItem("password");
        if (username)
            url.username = username;
        if (password)
            url.password = password;

        const ret: FFMpegInput = {
            inputArguments: [
                "-rtsp_transport",
                "tcp",
                '-analyzeduration', '15000000',
                '-probesize', '10000000',
                "-reorder_queue_size",
                "1024",
                "-max_delay",
                "20000000",
                "-i",
                url.toString(),
            ],
            mediaStreamOptions: vso,
        };

        return mediaManager.createFFmpegMediaObject(ret);
    }

    async getRtspUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'urls',
                title: 'RTSP Stream URL',
                description: 'An RTSP Stream URL provided by the camera.',
                placeholder: 'rtsp://192.168.1.100[:554]/channel/101',
                value: this.getRtspVideoStreamOptions()?.map(vso => vso.url),
                multiple: true,
            },
        ];
    }

    async getSnapshotUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'snapshotUrl',
                title: 'Snapshot URL',
                placeholder: 'http://192.168.1.100[:80]/snapshot.jpg',
                value: this.getSnapshotUrl(),
                description: 'Optional: The snapshot URL that will returns the current JPEG image.'
            },
        ];
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            ...await this.getSnapshotUrlSettings(),
            ...await this.getRtspUrlSettings(),
        ];
    }

    getUsername() {
        return this.storage.getItem('username');
    }

    getPassword() {
        return this.storage.getItem('password');
    }

    async getOtherSettings(): Promise<Setting[]> {
        return [];
    }

    isChannelEnabled(channelId: string) {
        return this.storage.getItem('disable-' + channelId) !== 'true';
    }

    async getStreamSettings(): Promise<Setting[]> {
        try {
            const vsos = await this.getVideoStreamOptions();
            if (!vsos?.length || vsos?.length === 1)
                return [];

            return vsos.map(channel => ({
                title: `Disable Stream: ${channel.name}`,
                key: 'disable-' + channel.id,
                value: (!this.isChannelEnabled(channel.id)).toString(),
                type: 'boolean',
                description: `Prevent usage of this RTSP channel: ${channel.url}`,
            }));
        }
        catch (e) {
            return [];
        }
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
                value: this.getUsername(),
            },
            {
                key: 'password',
                title: 'Password',
                value: this.getPassword(),
                type: 'password',
            },
            ...await this.getUrlSettings(),
            ...await this.getStreamSettings(),
            ...await this.getOtherSettings(),
            {
                key: 'noAudio',
                title: 'No Audio',
                description: 'Enable this setting if the camera does not have audio or to mute audio.',
                type: 'boolean',
                value: (this.isAudioDisabled()).toString(),
            },
        ];
    }

    async putRtspUrls(urls: string[]) {
        this.storage.setItem('urls', JSON.stringify(urls.filter(url => !!url)));
    }

    async putSettingBase(key: string, value: SettingValue) {
        if (key === 'urls') {
            this.putRtspUrls(value as string[]);
        }
        else {
            this.storage.setItem(key, value.toString());
        }

        this.snapshotAuth = undefined;
    }

    async putSetting(key: string, value: SettingValue) {
        this.putSettingBase(key, value);

        if (key === 'snapshotUrl') {
            let interfaces = this.providedInterfaces;
            if (!value)
                interfaces = interfaces.filter(iface => iface !== ScryptedInterface.Camera)
            else
                interfaces.push(ScryptedInterface.Camera);

            this.provider.updateDevice(this.nativeId, this.providedName, interfaces);
        }
    }
}

export interface Destroyable {
    destroy(): void;
}

export abstract class RtspSmartCamera extends RtspCamera {
    lastListen = 0;
    listener: EventEmitter & Destroyable;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);
        this.listenLoop();
    }

    resetSensors(): void {
        if (this.interfaces.includes(ScryptedInterface.MotionSensor))
            this.motionDetected = false;
        if (this.interfaces.includes(ScryptedInterface.AudioSensor))
            this.audioDetected = false;
        if (this.interfaces.includes(ScryptedInterface.IntrusionSensor))
            this.intrusionDetected = false;
        if (this.interfaces.includes(ScryptedInterface.BinarySensor))
            this.binaryState = false;
    }

    listenLoop() {
        this.resetSensors();
        this.lastListen = Date.now();
        this.listener = this.listenEvents();
        this.listener.on('error', e => {
            this.console.error('listen loop error, restarting in 10 seconds', e);
            const listenDuration = Date.now() - this.lastListen;
            const listenNext = listenDuration > 10000 ? 0 : 10000;
            setTimeout(() => this.listenLoop(), listenNext);
        });
    }

    async putSetting(key: string, value: SettingValue) {
        this.putSettingBase(key, value);
        this.listener.emit('error', new Error("new settings"));
    }

    async takePicture(option?: PictureOptions) {
        if (this.showSnapshotUrlOverride() && this.getSnapshotUrl()) {
            return super.takePicture(option);
        }

        return this.takeSmartCameraPicture(option);
    }

    abstract takeSmartCameraPicture(options?: PictureOptions): Promise<MediaObject>;

    async getSnapshotUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'snapshotUrl',
                title: 'Snapshot URL Override',
                placeholder: 'http://192.168.1.100[:80]/snapshot.jpg',
                value: this.storage.getItem('snapshotUrl'),
                description: 'Override the snapshot URL that will returns the current JPEG image.'
            },
        ];
    }

    async getRtspUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'urls',
                title: 'RTSP Stream URL Override',
                description: 'Override the RTSP Stream URL provided by the camera.',
                placeholder: 'rtsp://192.168.1.100[:554]/channel/101',
                value: this.getRtspVideoStreamOptions()?.map(vso => vso.url),
                multiple: true,
            },
        ];
    }

    async getUrlSettings() {
        const ret: Setting[] = [
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.1.100',
                value: this.storage.getItem('ip'),
            },
            ...this.getHttpPortOverrideSettings(),
            ...this.getRtspPortOverrideSettings(),
        ];

        if (this.showRtspUrlOverride()) {
            const legacyOverride = this.storage.getItem('rtspUrlOverride')
            if (legacyOverride) {
                await this.putRtspUrls([legacyOverride]);
                this.storage.removeItem('rtspUrlOverride');
            }

            ret.push(
                ... await this.getRtspUrlSettings(),
            );
        }

        if (this.showSnapshotUrlOverride()) {
            ret.push(
                ... await this.getSnapshotUrlSettings(),
            );
        }

        return ret;
    }

    getHttpPortOverrideSettings() {
        if (!this.showHttpPortOverride()) {
            return [];
        }
        return [
            {
                key: 'httpPort',
                title: 'HTTP Port Override',
                placeholder: '80',
                value: this.storage.getItem('httpPort'),
            }
        ];
    }

    showHttpPortOverride() {
        return true;
    }

    getRtspPortOverrideSettings() {
        if (!this.showRtspPortOverride()) {
            return [];
        }
        return [
            {
                key: 'rtspPort',
                title: 'RTSP Port Override',
                placeholder: '554',
                value: this.storage.getItem('rtspPort'),
            },
        ];
    }

    showRtspPortOverride() {
        return true;
    }

    showRtspUrlOverride() {
        return true;
    }

    showSnapshotUrlOverride() {
        return true;
    }

    getHttpAddress() {
        return `${this.getIPAddress()}:${this.storage.getItem('httpPort') || 80}`;
    }

    getRtspUrlOverride(options?: MediaStreamOptions) {
        if (!this.showRtspUrlOverride())
            return;
        return this.storage.getItem('rtspUrlOverride');
    }

    abstract getConstructedVideoStreamOptions(): Promise<RtspMediaStreamOptions[]>;
    abstract listenEvents(): EventEmitter & Destroyable;

    getIPAddress() {
        return this.storage.getItem('ip');
    }

    getRtspAddress() {
        return `${this.getIPAddress()}:${this.storage.getItem('rtspPort') || 554}`;
    }

    async getVideoStreamOptions(): Promise<RtspMediaStreamOptions[]> {
        if (this.showRtspUrlOverride()) {
            const vso = await super.getVideoStreamOptions();
            if (vso)
                return vso;
        }

        return this.getConstructedVideoStreamOptions();
    }
}

export class RtspProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }

        recommendRebroadcast();
    }

    getAdditionalInterfaces(): string[] {
        return [
        ];
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'new-camera',
                title: 'Add RTSP Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            }
        ]
    }

    getInterfaces() {
        return [ScryptedInterface.VideoCamera,
        ScryptedInterface.Settings, ...this.getAdditionalInterfaces()];
    }

    updateDevice(nativeId: string, name: string, interfaces: string[], type?: ScryptedDeviceType) {
        deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces,
            type: type || ScryptedDeviceType.Camera,
        });
    }

    async putSetting(key: string, value: string | number) {
        // generate a random id
        const nativeId = randomBytes(4).toString('hex');
        const name = value.toString();

        this.updateDevice(nativeId, name, this.getInterfaces());
    }

    async discoverDevices(duration: number) {
    }

    createCamera(nativeId: string, provider: RtspProvider): RtspCamera {
        return new RtspCamera(nativeId, provider);
    }

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = this.createCamera(nativeId, this);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }
}
