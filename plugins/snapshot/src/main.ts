import sdk, { Camera, MediaObject, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue } from "@scrypted/sdk";
import { SettingsMixinDeviceBase } from "@scrypted/common/src/settings-mixin"
import { StorageSettings } from "@scrypted/common/src/settings"
import AxiosDigestAuth from '@koush/axios-digest-auth';
import https from 'https';
import axios, { Axios } from "axios";

const { mediaManager } = sdk;
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

class SnapshotMixin extends SettingsMixinDeviceBase<Camera> implements Camera {
    storageSettings = new StorageSettings(this, {
        snapshotUrl: {
            title: 'Snapshot URL',
        }
    });
    axiosClient: Axios | AxiosDigestAuth;

    constructor(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }, providerNativeId: string) {
        super(mixinDevice, mixinDeviceState, {
            providerNativeId,
            mixinDeviceInterfaces,
            group: 'Snapshot',
            groupKey: 'snapshot',
        });
    }

    async takePicture(): Promise<MediaObject> {
        if (!this.axiosClient) {
            let username: string;
            let password: string;

            if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Settings)) {
                const settings = await this.mixinDevice.getSettings();
                username = settings?.find(setting => setting.key === 'username')?.value?.toString();
                password = settings?.find(setting => setting.key === 'userpasswordname')?.value?.toString();
            }

            if (username && password) {
                this.axiosClient = new AxiosDigestAuth({
                    username,
                    password,
                });
            }
            else {
                this.axiosClient = axios;
            }
        }

        const response = await this.axiosClient.request({
            httpsAgent,
            method: "GET",
            responseType: 'arraybuffer',
            url: this.storageSettings.values.snapshotUrl,
        });

        return mediaManager.createMediaObject(Buffer.from(response.data), 'image/jpeg');
    }

    async getPictureOptions() {
        return undefined;
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue) {
        return this.storageSettings.putSetting(key, value);
    }
}

class SnapshotPlugin extends ScryptedDeviceBase implements MixinProvider {
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (type === ScryptedDeviceType.Camera && interfaces.includes(ScryptedInterface.VideoCamera))
            return [ScryptedInterface.Camera, ScryptedInterface.Settings];
        return undefined;

    }
    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new SnapshotMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    }
}

export default new SnapshotPlugin();
