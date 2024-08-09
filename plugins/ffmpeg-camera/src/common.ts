import sdk, { Camera, DeviceCreator, DeviceCreatorSettings, DeviceProvider, MediaObject, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, Settings, SettingValue, VideoCamera } from "@scrypted/sdk";
import { randomBytes } from "crypto";

const { deviceManager } = sdk;

export interface UrlMediaStreamOptions extends ResponseMediaStreamOptions {
    url: string;
}

export abstract class CameraBase<T extends ResponseMediaStreamOptions> extends ScryptedDeviceBase implements Camera, VideoCamera, Settings {
    constructor(nativeId: string, public provider: CameraProviderBase<T>) {
        super(nativeId);
    }

    takePicture(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The RTSP Camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    async getVideoStreamOptions(): Promise<T[]> {
        const vsos = this.getRawVideoStreamOptions();
        return vsos;
    }

    abstract getRawVideoStreamOptions(): T[];

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
        return vsos?.[0];
    }

    async getStreamSettings(): Promise<Setting[]> {
        return [];
    }

    getUsernameDescription(): string {
        return 'Optional: Username for snapshot http requests.';
    }

    getPasswordDescription(): string {
        return 'Optional: Password for snapshot http requests.';
    }

    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [
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
        ];

        for (const s of ret) {
            s.group = this.provider.name.replace('Plugin', '').trim();
            s.subgroup ||= 'General';
        }

        return ret;
    }

    async putSettingBase(key: string, value: SettingValue) {
        if (key === 'defaultStream') {
            const vsos = await this.getVideoStreamOptions();
            const stream = vsos.find(vso => vso.name === value);
            this.storage.setItem('defaultStream', stream?.id || '');
        }
        else {
            this.storage.setItem(key, value.toString());
        }

        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    async putSetting(key: string, value: SettingValue) {
        this.putSettingBase(key, value);
    }
}

export abstract class CameraProviderBase<T extends ResponseMediaStreamOptions> extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        this.systemDevice = {
            deviceCreator: this.getScryptedDeviceCreator(),
        };
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: ScryptedNativeId): Promise<string> {
        nativeId ||= randomBytes(4).toString('hex');
        const name = settings.newCamera?.toString() || 'New Camera';
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
        return [
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Settings,
            ...this.getAdditionalInterfaces()
        ];
    }

    updateDevice(nativeId: string, name: string, interfaces: string[], type?: ScryptedDeviceType) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces,
            type: type || ScryptedDeviceType.Camera,
            info: deviceManager.getNativeIds().includes(nativeId) ? deviceManager.getDeviceState(nativeId)?.info : undefined,
        });
    }

    abstract createCamera(nativeId: string): CameraBase<T>;
    abstract getScryptedDeviceCreator(): string;

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = this.createCamera(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.devices.delete(nativeId);
    }
}
