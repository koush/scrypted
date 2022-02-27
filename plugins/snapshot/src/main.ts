import sdk, { Camera, MediaObject, MixinProvider, PictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue } from "@scrypted/sdk";
import { SettingsMixinDeviceBase } from "@scrypted/common/src/settings-mixin"
import { StorageSettings } from "@scrypted/common/src/settings"
import AxiosDigestAuth from '@koush/axios-digest-auth';
import https from 'https';
import axios, { Axios } from "axios";
import { TimeoutError, timeoutPromise } from "@scrypted/common/src/promise-utils";
import jimp from 'jimp';

const { mediaManager } = sdk;
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const fontPromise = jimp.loadFont(jimp.FONT_SANS_64_WHITE);

class NeverWaitError extends Error {

}

class SnapshotMixin extends SettingsMixinDeviceBase<Camera> implements Camera {
    storageSettings = new StorageSettings(this, {
        snapshotUrl: {
            title: this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)
                ? 'Override Snapshot URL'
                : 'Snapshot URL',
            description: (this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)
                ? 'Optional: '
                : '')
                + 'The http(s) URL that points that retrieves the latest image from your camera.',
            placeholder: 'https://ip:1234/cgi-bin/snapshot.jpg',
        },
        snapshotMode: {
            title: 'Snapshot Mode',
            description: 'Set the snapshot mode to accomodate cameras with slow snapshots that may hang HomeKit.\nSetting the mode to "Never Wait" will only use recently available snapshots.\nSetting the mode to "Timeout" will cancel slow snapshots.',
            choices: [
                'Normal',
                'Never Wait',
                'Timeout',
            ],
            defaultValue: 'Normal',
        },
        snapshotResolution: {
            title: 'Snapshot Resolution',
            description: 'Set resolution of the snapshots requested from the camera.',
            choices: [
                'Default',
                'Full Resolution',
            ],
            defaultValue: 'Default',
            hide: !this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera),
        }
    });
    axiosClient: Axios | AxiosDigestAuth;
    pendingPicture: Promise<Buffer>;
    lastPicture: Buffer;
    outdatedPicture: Buffer;

    constructor(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }, providerNativeId: string) {
        super(mixinDevice, mixinDeviceState, {
            providerNativeId,
            mixinDeviceInterfaces,
            group: 'Snapshot',
            groupKey: 'snapshot',
        });
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        let takePicture: () => Promise<Buffer>;
        if (!this.storageSettings.values.snapshotUrl && this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)) {
            takePicture = async () => {
                // if operating in full resolution mode, nuke any picture options containing
                // the requested dimensions that are sent.
                if (this.storageSettings.values.snapshotResolution === 'Full Resolution' && options)
                    options.picture = undefined;
                return this.mixinDevice.takePicture(options).then(mo => mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg'))
            };
        }
        else {

            if (!this.axiosClient) {
                let username: string;
                let password: string;

                if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Settings)) {
                    const settings = await this.mixinDevice.getSettings();
                    username = settings?.find(setting => setting.key === 'username')?.value?.toString();
                    password = settings?.find(setting => setting.key === 'password')?.value?.toString();
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

            takePicture = () => this.axiosClient.request({
                httpsAgent,
                method: "GET",
                responseType: 'arraybuffer',
                url: this.storageSettings.values.snapshotUrl,
            }).then((response: { data: any; }) => response.data);
        }

        if (!this.pendingPicture) {
            this.pendingPicture = takePicture().then(lastPicture => {
                this.lastPicture = lastPicture;
                this.outdatedPicture = this.lastPicture;
                return lastPicture;
            })
                .finally(() => this.pendingPicture = undefined);
        }

        const clearLastPicture = () => {
            const lp = this.lastPicture;
            setTimeout(() => {
                if (this.lastPicture === lp) {
                    this.lastPicture = undefined;
                }
            }, 30000);
        }

        let data: Buffer;
        if (this.storageSettings.values.snapshotMode === 'Normal') {
            data = await this.pendingPicture;
            clearLastPicture();
        }
        else {
            try {
                if (this.storageSettings.values.snapshotMode === 'Never Wait') {
                    if (!this.lastPicture) {
                        // this triggers an event to refresh the web ui.
                        this.pendingPicture.then(() => this.onDeviceEvent(ScryptedInterface.Camera, undefined));
                        throw new NeverWaitError();
                    }
                    data = this.lastPicture;
                }
                else {
                    data = await timeoutPromise(1000, this.pendingPicture);
                    clearLastPicture();
                }
            }
            catch (e) {
                let text: string;
                if (e instanceof TimeoutError)
                    text = 'Snapshot Timed Out';
                else if (e instanceof NeverWaitError)
                    text = 'Snapshot in Progress';
                else
                    text = 'Snapshot Failed';
                data = this.lastPicture || this.outdatedPicture;
                if (!data) {
                    const img = await jimp.create(1920 / 2, 1080 / 2);
                    const font = await fontPromise;
                    img.print(font, 0, 0, {
                        text,
                        alignmentX: jimp.HORIZONTAL_ALIGN_CENTER,
                        alignmentY: jimp.VERTICAL_ALIGN_MIDDLE,
                    }, img.getWidth(), img.getHeight());
                    data = await img.getBufferAsync('image/jpeg');
                }
                else {
                    const img = await jimp.read(data);
                    img.resize(1920 / 2, jimp.AUTO);
                    img.blur(15);
                    img.brightness(-.2);
                    const font = await fontPromise;
                    img.print(font, 0, 0, {
                        text,
                        alignmentX: jimp.HORIZONTAL_ALIGN_CENTER,
                        alignmentY: jimp.VERTICAL_ALIGN_MIDDLE,
                    }, img.getWidth(), img.getHeight());
                    data = await img.getBufferAsync('image/jpeg');
                }
            }
        }
        return mediaManager.createMediaObject(Buffer.from(data), 'image/jpeg');
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
        if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) && interfaces.includes(ScryptedInterface.VideoCamera))
            return [ScryptedInterface.Camera, ScryptedInterface.Settings];
        return undefined;

    }
    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new SnapshotMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release()
    }
}

export default new SnapshotPlugin();
