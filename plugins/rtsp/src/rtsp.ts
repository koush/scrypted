import { timeoutPromise } from '@scrypted/common/src/promise-utils';
import sdk, { MediaObject, MediaStreamUrl, PictureOptions, RequestPictureOptions, ResponseMediaStreamOptions, ScryptedInterface, ScryptedMimeTypes, Setting, SettingValue } from "@scrypted/sdk";
import url from 'url';
import { CameraBase, CameraProviderBase, UrlMediaStreamOptions } from "../../ffmpeg-camera/src/common";

export { UrlMediaStreamOptions } from "../../ffmpeg-camera/src/common";

export function createRtspMediaStreamOptions(url: string, index: number): UrlMediaStreamOptions {
    return {
        id: `channel${index}`,
        name: `Stream ${index + 1}`,
        url,
        container: 'rtsp',
        video: {
        },
        audio: {

        },
    };
}
export class RtspCamera extends CameraBase<UrlMediaStreamOptions> {
    takePicture(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The RTSP Camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
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
        const ret = urls.filter(url => !!url).map((url, index) => createRtspMediaStreamOptions(url, index));

        if (!ret.length)
            return;
        return ret;
    }

    addRtspCredentials(rtspUrl: string) {
        // ignore this deprecation warning. the WHATWG URL class will trim the password
        // off if it is empty, resulting in urls like rtsp://admin@foo.com/.
        // this causes ffmpeg to fail on sending a blank password.
        // we need to send it as follows: rtsp://admin:@foo.com/.
        // Note the trailing colon.
        // issue: https://github.com/koush/scrypted/issues/134
        const parsedUrl = url.parse(rtspUrl);
        this.console.log('stream url', rtspUrl);
        const username = this.storage.getItem("username");
        const password = this.storage.getItem("password");
        if (username) {
            // if a username is set, ensure a trailing colon is sent for blank password.
            const auth = `${username}:${password || ''}`;
            parsedUrl.auth = auth;
        }

        const stringUrl = url.format(parsedUrl);
        return stringUrl;
    }

    createMediaStreamUrl(stringUrl: string, vso: ResponseMediaStreamOptions) {
        const ret: MediaStreamUrl = {
            container: vso.container,
            url: stringUrl,
            mediaStreamOptions: vso,
        };

        return this.createMediaObject(ret, ScryptedMimeTypes.MediaStreamUrl);
    }

    async createVideoStream(vso: UrlMediaStreamOptions): Promise<MediaObject> {
        if (!vso)
            throw new Error('video streams not set up or no longer exists.');

        const stringUrl = this.addRtspCredentials(vso.url);
        return this.createMediaStreamUrl(stringUrl, vso);
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

    async getOtherSettings(): Promise<Setting[]> {
        const ret: Setting[] = [];

        ret.push(
            {
                subgroup: 'Advanced',
                key: 'debug',
                title: 'Debug Events',
                description: "Log all events to the console. This will be very noisy and should not be left enabled.",
                value: this.storage.getItem('debug') === 'true',
                type: 'boolean',
            }
        )
        return ret;
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            ...await this.getRtspUrlSettings(),
        ];
    }

    async putRtspUrls(urls: string[]) {
        this.storage.setItem('urls', JSON.stringify(urls.filter(url => !!url)));
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
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
    on(eventName: string | symbol, listener: (...args: any[]) => void): void;
    destroy(): void;
    emit(eventName: string | symbol, ...args: any[]): boolean;
}

export abstract class RtspSmartCamera extends RtspCamera {
    lastListen = 0;
    listener: Promise<Destroyable>;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);
        process.nextTick(() => this.listenLoop());
    }

    resetSensors(): void {
        if (this.interfaces.includes(ScryptedInterface.MotionSensor))
            this.motionDetected = false;
        if (this.interfaces.includes(ScryptedInterface.AudioSensor))
            this.audioDetected = false;
        if (this.interfaces.includes(ScryptedInterface.TamperSensor))
            this.tampered = false;
        if (this.interfaces.includes(ScryptedInterface.BinarySensor))
            this.binaryState = false;
    }

    async listenLoop() {
        this.resetSensors();
        this.lastListen = Date.now();
        if (this.listener)
            return;

        let listener: Destroyable;
        const listenerPromise = this.listener = this.listenEvents();

        let activityTimeout: NodeJS.Timeout;
        const restartListener = () => {
            if (listenerPromise === this.listener)
                this.listener = undefined;
            clearTimeout(activityTimeout);
            listener?.destroy();
            const listenDuration = Date.now() - this.lastListen;
            const listenNext = listenDuration > 10000 ? 0 : 10000;
            setTimeout(() => this.listenLoop(), listenNext);
        }

        try {
            listener = await this.listener;
        }
        catch (e) {
            this.console.error('listen loop connection failed, restarting listener.', e.message);
            restartListener();
            return;
        }

        const resetActivityTimeout = () => {
            clearTimeout(activityTimeout);
            activityTimeout = setTimeout(() => {
                this.console.error('listen loop 5m idle timeout, destroying listener.');
                restartListener();
            }, 300000);
        }
        resetActivityTimeout();

        listener.on('data', (data) => {
            if (this.storage.getItem('debug') === 'true')
                this.console.log('debug event:\n', data.toString());
            resetActivityTimeout();
        });

        listener.on('close', () => {
            this.console.error('listen loop closed, restarting listener.');
            restartListener();
        });

        listener.on('error', e => {
            this.console.error('listen loop error, restarting listener.', e);
            restartListener();
        });
    }

    async putSetting(key: string, value: SettingValue) {
        this.putSettingBase(key, value);
        this.listener?.then(l => l.emit('error', new Error("new settings")));
    }

    async takePicture(options?: RequestPictureOptions) {
        return this.takeSmartCameraPicture(options);
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
            ...await this.getRtspPortOverrideSettings(),
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
                subgroup: 'Advanced',
                title: 'HTTP Port Override',
                placeholder: '80',
                value: this.storage.getItem('httpPort'),
            }
        ];
    }

    showHttpPortOverride() {
        return true;
    }

    async getRtspPortOverrideSettings(): Promise<Setting[]> {
        if (!this.showRtspPortOverride()) {
            return [];
        }
        return [
            {
                key: 'rtspPort',
                subgroup: 'Advanced',
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
        this.storage.setItem('httpPort', port || '');
    }

    getRtspUrlOverride() {
        if (!this.showRtspUrlOverride())
            return;
        return this.storage.getItem('rtspUrlOverride');
    }

    abstract getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]>;
    abstract listenEvents(): Promise<Destroyable>;

    getIPAddress() {
        return this.storage.getItem('ip');
    }

    setIPAddress(ip: string) {
        return this.storage.setItem('ip', ip);
    }

    getRtspAddress() {
        return `${this.getIPAddress()}:${this.storage.getItem('rtspPort') || 554}`;
    }

    constructedVideoStreamOptions: Promise<UrlMediaStreamOptions[]>;
    async getVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (this.showRtspUrlOverride()) {
            const vsos = await super.getVideoStreamOptions();
            if (vsos)
                return vsos;
        }

        if (this.constructedVideoStreamOptions)
            return this.constructedVideoStreamOptions;

        this.constructedVideoStreamOptions = timeoutPromise(5000, this.getConstructedVideoStreamOptions()).finally(() => {
            this.constructedVideoStreamOptions = undefined;
        });

        return this.constructedVideoStreamOptions;
    }

    putSettingBase(key: string, value: SettingValue): Promise<void> {
        this.constructedVideoStreamOptions = undefined;
        return super.putSettingBase(key, value);
    }
}

export abstract class RtspProvider extends CameraProviderBase<UrlMediaStreamOptions> {
    createCamera(nativeId: string): RtspCamera {
        return new RtspCamera(nativeId, this);
    }
}
