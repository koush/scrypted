import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, MediaStreamOptions, ScryptedInterface, FFMpegInput, Camera, PictureOptions, SettingValue, DeviceCreator, DeviceCreatorSettings } from "@scrypted/sdk";
import AxiosDigestAuth from '@koush/axios-digest-auth';
import https from 'https';
import { randomBytes } from "crypto";

const { deviceManager, mediaManager } = sdk;

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

export interface UrlMediaStreamOptions extends MediaStreamOptions {
    url: string;
}

export abstract class CameraBase<T extends MediaStreamOptions> extends ScryptedDeviceBase implements Camera, VideoCamera, Settings {
    snapshotAuth: AxiosDigestAuth;
    pendingPicture: Promise<MediaObject>;

    constructor(nativeId: string, public provider: CameraProviderBase<T>) {
        super(nativeId);
    }

    protected async takePictureUrl(snapshotUrl: string) {
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

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        if (!this.pendingPicture) {
            this.pendingPicture = this.takePictureThrottled(option);
            this.pendingPicture.finally(() => this.pendingPicture = undefined);
        }

        return this.pendingPicture;
    }

    abstract takePictureThrottled(option?: PictureOptions): Promise<MediaObject>;

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    getDefaultOrderedVideoStreamOptions(vsos: T[]) {
        if (!vsos || !vsos.length)
            return vsos;
        const defaultStream = this.getDefaultStream(vsos);
        if (!defaultStream)
            return vsos;
        vsos = vsos.filter(vso => vso.id !== defaultStream?.id);
        vsos.unshift(defaultStream);
        return vsos;
    }

    async getVideoStreamOptions(): Promise<T[]> {
        let vsos = this.getRawVideoStreamOptions();
        return this.getDefaultOrderedVideoStreamOptions(vsos);
    }

    abstract getRawVideoStreamOptions(): T[];

    isAudioDisabled() {
        return this.storage.getItem('noAudio') === 'true';
    }

    async getVideoStream(options?: T): Promise<MediaObject> {
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos?.find(s => s.id === options?.id) || this.getDefaultStream(vsos);
        return this.createVideoStream(vso);
    }

    abstract createVideoStream(options?: T): Promise<MediaObject>;

    async getUrlSettings(): Promise<Setting[]> {
        return [
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

    getDefaultStream(vsos: T[]) {
        let defaultStreamIndex = vsos?.findIndex(vso => vso.id === this.storage.getItem('defaultStream'));
        if (defaultStreamIndex === -1)
            defaultStreamIndex = 0;

        defaultStreamIndex = defaultStreamIndex || 0;
        return vsos?.[defaultStreamIndex];
    }

    async getStreamSettings(): Promise<Setting[]> {
        try {
            const vsos = await this.getVideoStreamOptions();
            if (!vsos?.length || vsos?.length === 1)
                return [];


            const defaultStream = this.getDefaultStream(vsos);
            return [
                {
                    title: 'Default Stream',
                    group: 'Advanced',
                    key: 'defaultStream',
                    value: defaultStream?.name,
                    choices: vsos.map(vso => vso.name),
                    description: 'The default stream to use when not specified',
                }
            ];
        }
        catch (e) {
            return [];
        }
    }

    getUsernameDescription(): string {
        return 'Optional: Username for snapshot http requests.';
    }

    getPasswordDescription(): string {
        return 'Optional: Password for snapshot http requests.';
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
                value: this.getUsername(),
                description: this.getUsernameDescription(),
            },
            {
                key: 'password',
                title: 'Password',
                value: this.getPassword(),
                type: 'password',
                description: this.getPasswordDescription(),
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

    async putSettingBase(key: string, value: SettingValue) {
        if (key === 'defaultStream') {
            const vsos = await this.getVideoStreamOptions();
            const stream = vsos.find(vso => vso.name === value);
            this.storage.setItem('defaultStream', stream?.id);
        }
        else {
            this.storage.setItem(key, value.toString());
        }

        this.snapshotAuth = undefined;

        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    async putSetting(key: string, value: SettingValue) {
        this.putSettingBase(key, value);
    }
}

export abstract class CameraProviderBase<T extends MediaStreamOptions> extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = randomBytes(4).toString('hex');
        const name = settings.newCamera.toString();
        await this.updateDevice(nativeId, name, this.getInterfaces());
        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'newCamera',
                title: 'Add Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            }
        ]
    }

    getAdditionalInterfaces(): string[] {
        return [
        ];
    }

    getInterfaces() {
        return [ScryptedInterface.VideoCamera,
        ScryptedInterface.Settings, ...this.getAdditionalInterfaces()];
    }

    updateDevice(nativeId: string, name: string, interfaces: string[], type?: ScryptedDeviceType) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces,
            type: type || ScryptedDeviceType.Camera,
        });
    }

    abstract createCamera(nativeId: string): CameraBase<T>;

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = this.createCamera(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }
}
