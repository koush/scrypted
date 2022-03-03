import sdk, { Setting, MediaObject, ScryptedInterface, FFMpegInput, PictureOptions, SettingValue, MediaStreamOptions } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import { CameraProviderBase, CameraBase, UrlMediaStreamOptions } from "../../ffmpeg-camera/src/common";
import url from 'url';

export { UrlMediaStreamOptions } from "../../ffmpeg-camera/src/common";

const { mediaManager } = sdk;

export class RtspCamera extends CameraBase<UrlMediaStreamOptions> {
    takePictureThrottled(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The RTSP Camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
    }

    createRtspMediaStreamOptions(url: string, index: number): UrlMediaStreamOptions {
        return {
            id: `channel${index}`,
            name: `Stream ${index + 1}`,
            url,
            container: 'rtsp',
            video: {
            },
            audio: this.isAudioDisabled() ? null : {},
        };
    }

    getChannelFromMediaStreamOptionsId(id: string) {
        return id.substring('channel'.length);
    }

    getRawVideoStreamOptions(): UrlMediaStreamOptions[] {
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

    async createVideoStream(vso: UrlMediaStreamOptions): Promise<MediaObject> {
        if (!vso)
            throw new Error('video streams not set up or no longer exists.');

        // ignore this deprecation warning. the WHATWG URL class will trim the password
        // off if it is empty, resulting in urls like rtsp://admin@foo.com/.
        // this causes ffmpeg to fail on sending a blank password.
        // we need to send it as follows: rtsp://admin:@foo.com/.
        // Note the trailing colon.
        // issue: https://github.com/koush/scrypted/issues/134
        const parsedUrl = url.parse(vso.url);
        this.console.log('rtsp stream url', vso.url);
        const username = this.storage.getItem("username");
        const password = this.storage.getItem("password");
        if (username) {
            // if a username is set, ensure a trailing colon is sent for blank password.
            const auth = `${username}:${password || ''}`;
            parsedUrl.auth = auth;
        }

        const stringUrl = url.format(parsedUrl);

        const ret: FFMpegInput = {
            url: stringUrl,
            inputArguments: [
                "-rtsp_transport", this.getRtspTransport(),
                "-i", stringUrl,
            ],
            mediaStreamOptions: vso,
        };

        return mediaManager.createFFmpegMediaObject(ret);
    }

    // hide the description from CameraBase that indicates it is only used for snapshots
    getUsernameDescription(): string {
        return;
    }

    // hide the description from CameraBase that indicates it is only used for snapshots
    getPasswordDescription(): string {
        return;
    }

    async getRtspUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'urls',
                title: 'RTSP Stream URL',
                description: 'An RTSP Stream URL provided by the camera.',
                placeholder: 'rtsp://192.168.1.100[:554]/channel/101',
                value: this.getRawVideoStreamOptions()?.map(vso => vso.url),
                multiple: true,
            },
        ];
    }

    async getRtspTransportSettings(): Promise<Setting[]> {
        return [
            {
                key: 'rtspTransport',
                title: 'RTSP Transport',
                group: 'Advanced',
                description: 'The RTSP Transport to use when streaming video. TCP is the default.',
                value: this.getRtspTransport(),
                choices: [
                    'tcp',
                    'udp',
                ],
            },
        ]
    }

    getRtspTransport() {
        return this.storage.getItem('rtspTransport') || 'tcp'
    }

    async getOtherSettings(): Promise<Setting[]> {
        return this.getRtspTransportSettings();
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            ...await this.getRtspUrlSettings(),
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
            super.putSettingBase(key, value);
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

    async takePictureThrottled(option?: PictureOptions) {
        return this.takeSmartCameraPicture(option);;
    }

    abstract takeSmartCameraPicture(options?: PictureOptions): Promise<MediaObject>;

    async getRtspUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'urls',
                title: 'RTSP Stream URL Override',
                description: 'Override the RTSP Stream URL provided by the camera.',
                placeholder: 'rtsp://192.168.1.100[:554]/channel/101',
                value: this.getRawVideoStreamOptions()?.map(vso => vso.url),
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

        return ret;
    }

    getHttpPortOverrideSettings() {
        if (!this.showHttpPortOverride()) {
            return [];
        }
        return [
            {
                key: 'httpPort',
                group: 'Advanced',
                title: 'HTTP Port Override',
                placeholder: '80',
                value: this.storage.getItem('httpPort'),
            }
        ];
    }

    showHttpPortOverride() {
        return true;
    }

    getRtspPortOverrideSettings(): Setting[] {
        if (!this.showRtspPortOverride()) {
            return [];
        }
        return [
            {
                key: 'rtspPort',
                group: 'Advanced',
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

    getHttpAddress() {
        return `${this.getIPAddress()}:${this.storage.getItem('httpPort') || 80}`;
    }

    setHttpPortOverride(port: string) {
        this.storage.setItem('httpPort', port);
    }

    getRtspUrlOverride() {
        if (!this.showRtspUrlOverride())
            return;
        return this.storage.getItem('rtspUrlOverride');
    }

    abstract getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]>;
    abstract listenEvents(): EventEmitter & Destroyable;

    getIPAddress() {
        return this.storage.getItem('ip');
    }

    setIPAddress(ip: string) {
        return this.storage.setItem('ip', ip);
    }

    getRtspAddress() {
        return `${this.getIPAddress()}:${this.storage.getItem('rtspPort') || 554}`;
    }

    async getVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (this.showRtspUrlOverride()) {
            const vso = await super.getVideoStreamOptions();
            if (vso)
                return vso;
        }

        const vsos = await this.getConstructedVideoStreamOptions();
        return this.getDefaultOrderedVideoStreamOptions(vsos);
    }
}

export class RtspProvider extends CameraProviderBase<UrlMediaStreamOptions> {
    createCamera(nativeId: string): RtspCamera {
        return new RtspCamera(nativeId, this);
    }
}
