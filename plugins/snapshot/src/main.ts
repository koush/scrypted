import sdk, { Camera, MediaObject, MixinProvider, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, VideoCamera } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin"
import { StorageSettings } from "@scrypted/common/src/settings"
import AxiosDigestAuth from '@koush/axios-digest-auth';
import https from 'https';
import axios, { Axios } from "axios";
import { TimeoutError, timeoutPromise } from "@scrypted/common/src/promise-utils";
import { AutoenableMixinProvider } from "@scrypted/common/src/autoenable-mixin-provider";
import jimp from 'jimp';

const { systemManager } = sdk;

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
        snapshotsFromPrebuffer: {
            title: 'Snapshots from Prebuffer',
            description: 'Prefer snapshots from the Rebroadcast Plugin prebuffer when available.',
            type: 'boolean',
            defaultValue: !this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera),
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
        },
        snapshotCropScale: {
            title: 'Crop and Scale',
            description: 'Set the approximate region to crop and scale to 16:9 snapshots.',
            type: 'clippath',
        },
    });
    axiosClient: Axios | AxiosDigestAuth;
    pendingPicture: Promise<Buffer>;
    // this will contain the last picture retrieved,
    // or an outdated picture blurred with an error overlay.
    lastPicture: Buffer;
    rawLastPicture: Buffer;

    constructor(options: SettingsMixinDeviceOptions<Camera>) {
        super(options);
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        let takePicture: () => Promise<Buffer>;
        if (this.storageSettings.values.snapshotsFromPrebuffer) {
            try {
                const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
                const msos = await realDevice.getVideoStreamOptions();
                for (const mso of msos) {
                    if (mso.prebuffer) {
                        const request = mso as RequestMediaStreamOptions;
                        request.refresh = false;
                        takePicture = async () => mediaManager.convertMediaObjectToBuffer(await realDevice.getVideoStream(request), 'image/jpeg');
                        // a prebuffer snapshot should wipe out any pending pictures
                        // that may not have come from the prebuffer to allow a safe-ish/fast refresh.
                        this.pendingPicture = undefined;
                        this.console.log('snapshotting active prebuffer');
                        break;
                    }
                }
            }
            catch (e) {
            }
        }

        if (!takePicture) {
            if (!this.storageSettings.values.snapshotUrl) {
                if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)) {
                    takePicture = async () => {
                        // if operating in full resolution mode, nuke any picture options containing
                        // the requested dimensions that are sent.
                        if (this.storageSettings.values.snapshotResolution === 'Full Resolution' && options)
                            options.picture = undefined;
                        return this.mixinDevice.takePicture(options).then(mo => mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg'))
                    };
                }
                else {
                    takePicture = () => {
                        throw new Error('Snapshot Unavailable (snapshotUrl empty, and prebuffer not available or enabled)');
                    }
                }
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
        }

        if (!this.pendingPicture) {
            const pendingPicture = (async () => {
                let picture: Buffer;
                try {
                    picture = await takePicture();
                    picture = await this.cropAndScale(picture);
                    this.rawLastPicture = picture;
                }
                catch (e) {
                    picture = await this.createErrorImage(e);
                }
                this.lastPicture = picture;
                setTimeout(() => {
                    if (this.lastPicture === picture) {
                        this.lastPicture = undefined;
                    }
                }, 30000);
                return picture;
            })();

            this.pendingPicture = pendingPicture;
            // prevent infinite loop from onDeviceEvent triggering picture updates.
            // retain this promise for a bit while everything settles.
            pendingPicture.finally(() => {
                setTimeout(() => {
                    if (this.pendingPicture === pendingPicture)
                        this.pendingPicture = undefined;
                }, 5000);
            });
        }

        let data: Buffer;
        if (this.storageSettings.values.snapshotMode === 'Normal') {
            data = await this.pendingPicture;
        }
        else {
            try {
                if (this.storageSettings.values.snapshotMode === 'Never Wait') {
                    if (!this.lastPicture) {
                        // this triggers an event to refresh the web ui.
                        this.pendingPicture.then(() => this.onDeviceEvent(ScryptedInterface.Camera, undefined));
                        data = await this.createErrorImage(new NeverWaitError());
                    }
                    else {
                        data = this.lastPicture;
                    }
                }
                else {
                    data = await timeoutPromise(1000, this.pendingPicture);
                }
            }
            catch (e) {
                data = await this.createErrorImage(e);
            }
        }
        return mediaManager.createMediaObject(Buffer.from(data), 'image/jpeg');
    }

    async cropAndScale(buffer: Buffer) {
        if (!this.storageSettings.values.snapshotCropScale?.length)
            return buffer;

        const xmin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;
        const xmax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;

        this.console.log(xmin, ymin, xmax, ymax);
        const img = await jimp.read(buffer);
        let pw = xmax - xmin;
        let ph = pw / (16 / 9);

        const x = Math.round(xmin * img.getWidth());
        const w = Math.round(xmax * img.getWidth()) - x;
        const ymid = (ymin + ymax) / 2;
        let y = Math.round((ymid - ph / 2) * img.getHeight());
        let h = Math.round((ymid + ph / 2) * img.getHeight()) - y;
        img.crop(x, y, w, h);
        const cropped = await img.getBufferAsync('image/jpeg');
        return cropped;
    }

    async createErrorImage(e: any) {
        this.console.log('creating error snapshot', e);
        let text: string;
        if (e instanceof TimeoutError)
            text = 'Snapshot Timed Out';
        else if (e instanceof NeverWaitError)
            text = 'Snapshot in Progress';
        else
            text = 'Snapshot Failed';
        if (!this.rawLastPicture) {
            const img = await jimp.create(1920 / 2, 1080 / 2);
            const font = await fontPromise;
            img.print(font, 0, 0, {
                text,
                alignmentX: jimp.HORIZONTAL_ALIGN_CENTER,
                alignmentY: jimp.VERTICAL_ALIGN_MIDDLE,
            }, img.getWidth(), img.getHeight());
            return img.getBufferAsync('image/jpeg');
        }
        else {
            const img = await jimp.read(this.rawLastPicture);
            img.resize(1920 / 2, jimp.AUTO);
            img.blur(15);
            img.brightness(-.2);
            const font = await fontPromise;
            img.print(font, 0, 0, {
                text,
                alignmentX: jimp.HORIZONTAL_ALIGN_CENTER,
                alignmentY: jimp.VERTICAL_ALIGN_MIDDLE,
            }, img.getWidth(), img.getHeight());
            return img.getBufferAsync('image/jpeg');
        }
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

class SnapshotPlugin extends AutoenableMixinProvider implements MixinProvider {
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) && interfaces.includes(ScryptedInterface.VideoCamera))
            return [ScryptedInterface.Camera, ScryptedInterface.Settings];
        return undefined;
    }
    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new SnapshotMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
            group: 'Snapshot',
            groupKey: 'snapshot',
        });
    }

    async shouldEnableMixin(device: ScryptedDevice) {
        const { type, interfaces } = device;
        // auto enable this on VideoCameras that do not have snapshot capability.
        if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell)
            && interfaces.includes(ScryptedInterface.VideoCamera) && !interfaces.includes(ScryptedInterface.Camera))
            return true;
        return false;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release()
    }
}

export default new SnapshotPlugin();
