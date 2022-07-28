import AxiosDigestAuth from '@koush/axios-digest-auth';
import { AutoenableMixinProvider } from "@scrypted/common/src/autoenable-mixin-provider";
import { RefreshPromise, singletonPromise, TimeoutError, timeoutPromise } from "@scrypted/common/src/promise-utils";
import { StorageSettings } from "@scrypted/common/src/settings";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import sdk, { Camera, MediaObject, MixinProvider, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, ResponsePictureOptions, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, VideoCamera } from "@scrypted/sdk";
import axios, { Axios } from "axios";
import https from 'https';
import jimp from 'jimp';
import { newThread } from '../../../server/src/threading';

const { mediaManager, systemManager } = sdk;

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

class NeverWaitError extends Error {

}

class PrebufferUnavailableError extends Error {

}

class SnapshotMixin extends SettingsMixinDeviceBase<Camera> implements Camera {
    storageSettings = new StorageSettings(this, {
        defaultSnapshotChannel: {
            title: 'Default Snapshot Channel',
            description: 'The default channel to use for snapshots.',
            defaultValue: 'Camera Default',
            hide: !this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera),
            onGet: async () => {
                if (!this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)) {
                    return {
                        hide: true,
                    };
                }

                let psos: ResponsePictureOptions[];
                try {
                    psos = await this.mixinDevice.getPictureOptions();
                }
                catch (e) {
                }

                if (!psos?.length) {
                    return {
                        hide: true,
                    };
                }

                return {
                    hide: false,
                    choices: [
                        'Camera Default',
                        ...psos.map(pso => pso.name),
                    ],
                };
            }
        },
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
                'Default',
                'Never Wait',
                'Timeout',
            ],
            mapGet(value) {
                // renamed the setting value.
                return value === 'Normal' ? 'Default' : value;
            },
            defaultValue: 'Default',
        },
        snapshotResolution: {
            title: 'Snapshot Resolution',
            description: 'Set resolution of the snapshots requested from the camera.',
            choices: [
                'Default',
                'Full Resolution',
                'Requested Resolution',
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
    errorPicture: RefreshPromise<Buffer>;
    timeoutPicture: RefreshPromise<Buffer>;
    progressPicture: RefreshPromise<Buffer>;
    prebufferUnavailablePicture: RefreshPromise<Buffer>;
    currentPicture: Buffer;
    lastErrorImagesClear = 0;
    static lastGeneratedErrorImageTime = 0;
    lastAvailablePicture: Buffer;

    constructor(options: SettingsMixinDeviceOptions<Camera>) {
        super(options);
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        let takePicture: (options?: RequestPictureOptions) => Promise<Buffer>;
        if (this.storageSettings.values.snapshotsFromPrebuffer) {
            try {
                const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
                const msos = await realDevice.getVideoStreamOptions();
                let prebufferChannel = msos?.find(mso => mso.prebuffer);
                if (prebufferChannel || !this.lastAvailablePicture) {
                    prebufferChannel = prebufferChannel || {
                        id: undefined,
                    };

                    const request = prebufferChannel as RequestMediaStreamOptions;
                    if (this.lastAvailablePicture)
                        request.refresh = false;
                    takePicture = async () => mediaManager.convertMediaObjectToBuffer(await realDevice.getVideoStream(request), 'image/jpeg');
                    this.console.log('snapshotting active prebuffer');
                }
            }
            catch (e) {
            }
        }

        if (!takePicture) {
            if (!this.storageSettings.values.snapshotUrl) {
                if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)) {
                    takePicture = async (options?: RequestPictureOptions) => {
                        // if operating in full resolution mode, nuke any picture options containing
                        // the requested dimensions that are sent.
                        let picture = options?.picture;
                        let psos: ResponsePictureOptions[];
                        let needResize = false;
                        if (options
                            && (this.storageSettings.values.snapshotResolution === 'Full Resolution'
                                || (this.storageSettings.values.snapshotResolution === 'Requested Resolution'
                                    || this.storageSettings.values.snapshotResolution === 'Default'
                                    && (options.picture?.width || options.picture?.height)))
                        ) {
                            if (this.storageSettings.values.snapshotResolution === 'Default') {
                                try {
                                    if (!psos)
                                        psos = await this.mixinDevice.getPictureOptions();
                                    if (!psos?.[0].canResize) {
                                        needResize = true;
                                    }
                                }
                                catch (e) {
                                }
                            }
                            else {
                                needResize = true;
                                options.picture = undefined;
                            }
                        }

                        if (!options?.id && this.storageSettings.values.defaultSnapshotChannel !== 'Camera Default') {
                            try {
                                if (!psos)
                                    psos = await this.mixinDevice.getPictureOptions();
                                const pso = psos.find(pso => pso.name === this.storageSettings.values.defaultSnapshotChannel);
                                if (!options)
                                    options = {};
                                options.id = pso.id;
                            }
                            catch (e) {
                            }
                        }
                        const ret = await this.mixinDevice.takePicture(options).then(mo => mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg'))
                        if (!needResize)
                            return ret;
                        const image = await jimp.read(ret);
                        const scale = Math.max((picture.width / image.getWidth()) || 0,
                            (picture.height / image.getHeight()) || 0);
                        if (Math.abs(1 - scale) < .2)
                            return ret;
                        image.scale(scale);
                        return image.getBufferAsync('image/jpeg');
                    };
                }
                else if (this.storageSettings.values.snapshotsFromPrebuffer) {
                    takePicture = async () => {
                        throw new PrebufferUnavailableError();
                    }
                }
                else {
                    takePicture = () => {
                        throw new Error('Snapshot Unavailable (snapshotUrl empty)');
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

        const hadPendingPicture = !!this.pendingPicture;
        if (!hadPendingPicture) {
            const pendingPicture = (async () => {
                let picture: Buffer;
                try {
                    picture = await takePicture(options);
                    picture = await this.cropAndScale(picture);
                    this.clearCachedPictures();
                    this.currentPicture = picture;
                    this.lastAvailablePicture = picture;
                    setTimeout(() => {
                        if (this.currentPicture === picture) {
                            // only clear the current picture after it times out,
                            // the plugin shouldn't invalidate error, timeout, progress
                            // images unless the current picture is updated.
                            this.currentPicture = undefined;
                        }
                    }, 60000);
                }
                catch (e) {
                    // allow reusing the current picture to mask errors
                    picture = await this.createErrorImage(e);
                }
                return picture;
            })();

            this.pendingPicture = pendingPicture;

            // don't allow a snapshot to take longer than 1 minute.
            const failureTimeout = setTimeout(() => {
                if (this.pendingPicture === pendingPicture)
                    this.pendingPicture = undefined;
            }, 60000);
            // prevent infinite loop from onDeviceEvent triggering picture updates.
            // retain this promise for a bit while everything settles.
            // this also has a side effect of only allowing snapshots every 5 seconds.
            pendingPicture.finally(() => {
                clearTimeout(failureTimeout);
                setTimeout(() => {
                    if (this.pendingPicture === pendingPicture)
                        this.pendingPicture = undefined;
                }, 5000);
            });
        }

        // this triggers an event to refresh the web ui.
        // but only trigger a refresh if this call fetched the picture.
        if (!hadPendingPicture)
            this.pendingPicture.then(() => this.onDeviceEvent(ScryptedInterface.Camera, undefined));

        let data: Buffer;
        try {
            switch (this.storageSettings.values.snapshotMode) {
                case 'Never Wait':
                    throw new NeverWaitError();
                case 'Timeout':
                    data = await timeoutPromise(1000, this.pendingPicture);
                    break;
                default:
                    data = await this.pendingPicture;
                    break;
            }
        }
        catch (e) {
            // allow reusing the current picture to mask errors
            if (this.currentPicture)
                data = this.currentPicture;
            else
                data = await this.createErrorImage(e);
        }
        return this.createMediaObject(Buffer.from(data), 'image/jpeg');
    }

    async cropAndScale(buffer: Buffer) {
        if (!this.storageSettings.values.snapshotCropScale?.length)
            return buffer;

        const xmin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;
        const xmax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;

        this.console.log(xmin, ymin, xmax, ymax);
        return newThread({ jimp }, {
            buffer,
            xmin, xmax,
            ymin, ymax,
        }, async ({
            jimp,
            buffer,
            xmin, xmax,
            ymin, ymax,
        }) => {
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
        });
    }

    clearErrorImages() {
        this.errorPicture = undefined;
        this.timeoutPicture = undefined;
        this.progressPicture = undefined;
        this.prebufferUnavailablePicture = undefined;
    }

    clearCachedPictures() {
        // if previous error pictures were generated with the black background,
        // clear it out to force a real blurred image.
        if (!this.lastAvailablePicture)
            this.clearErrorImages();
        this.currentPicture = undefined;
    }

    maybeClearErrorImages() {
        const now = Date.now();

        // only clear the error images if they are at least an hour old
        if (now - this.lastErrorImagesClear > 1 * 60 * 60 * 1000)
            return;

        // only clear error images generated once a per minute across all cameras
        if (now - SnapshotMixin.lastGeneratedErrorImageTime < 60 * 1000)
            return;

        SnapshotMixin.lastGeneratedErrorImageTime = now;
        this.lastErrorImagesClear = now;
        this.clearErrorImages();
    }

    async createErrorImage(e: any) {
        this.maybeClearErrorImages();

        if (e instanceof TimeoutError) {
            this.timeoutPicture = singletonPromise(this.timeoutPicture,
                () => this.createTextErrorImage('Snapshot Timed Out'));
            return this.timeoutPicture.promise;
        }
        else if (e instanceof PrebufferUnavailableError) {
            this.prebufferUnavailablePicture = singletonPromise(this.prebufferUnavailablePicture,
                () => this.createTextErrorImage('Snapshot Unavailable'));
            return this.prebufferUnavailablePicture.promise;
        }
        else if (e instanceof NeverWaitError) {
            this.progressPicture = singletonPromise(this.progressPicture,
                () => this.createTextErrorImage('Snapshot In Progress'));
            return this.progressPicture.promise;
        }
        else {
            this.errorPicture = singletonPromise(this.errorPicture,
                () => this.createTextErrorImage('Snapshot Failed'));
            return this.errorPicture.promise;
        }
    }

    async createTextErrorImage(text: string) {
        const errorBackground = this.currentPicture || this.lastAvailablePicture;
        this.console.log('creating error image with background', text, !!errorBackground);
        return newThread({ jimp }, {
            errorBackground,
            text,
        }, async ({ errorBackground, text, jimp }) => {
            const fontPromise = jimp.loadFont(jimp.FONT_SANS_64_WHITE);

            if (!errorBackground) {
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
                const img = await jimp.read(errorBackground);
                img.resize(1920 / 2, jimp.AUTO);
                img.blur(8);
                img.brightness(-.2);
                const font = await fontPromise;
                img.print(font, 0, 0, {
                    text,
                    alignmentX: jimp.HORIZONTAL_ALIGN_CENTER,
                    alignmentY: jimp.VERTICAL_ALIGN_MIDDLE,
                }, img.getWidth(), img.getHeight());
                return img.getBufferAsync('image/jpeg');
            }
        })
    }

    async getPictureOptions() {
        return this.mixinDevice.getPictureOptions();
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
