import AxiosDigestAuth from '@koush/axios-digest-auth';
import { AutoenableMixinProvider } from "@scrypted/common/src/autoenable-mixin-provider";
import { createMapPromiseDebouncer, RefreshPromise, singletonPromise, TimeoutError } from "@scrypted/common/src/promise-utils";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import sdk, { BufferConverter, Camera, DeviceProvider, FFmpegInput, Image, MediaObject, MediaObjectOptions, MixinProvider, RequestMediaStreamOptions, RequestPictureOptions, ResponsePictureOptions, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import axios, { AxiosInstance } from "axios";
import https from 'https';
import path from 'path';
import MimeType from 'whatwg-mimetype';
import { ffmpegFilterImage, ffmpegFilterImageBuffer } from './ffmpeg-image-filter';
import { ImageWriter, ImageWriterNativeId } from './image-writer';

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
                + 'The http(s) URL that retrieves a jpeg image from your camera.',
            placeholder: 'https://ip:1234/cgi-bin/snapshot.jpg',
        },
        snapshotsFromPrebuffer: {
            title: 'Snapshots from Prebuffer',
            description: 'Prefer snapshots from the Rebroadcast Plugin prebuffer when available. This setting uses considerable CPU to convert a video stream into a snapshot. The Default setting will use the camera snapshot and fall back to prebuffer on failure.',
            choices: [
                'Default',
                'Enabled',
                'Disabled',
            ],
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
    snapshotDebouncer = createMapPromiseDebouncer<Buffer>();
    errorPicture: RefreshPromise<Buffer>;
    timeoutPicture: RefreshPromise<Buffer>;
    progressPicture: RefreshPromise<Buffer>;
    prebufferUnavailablePicture: RefreshPromise<Buffer>;
    currentPicture: Buffer;
    currentPictureTime = 0;
    lastErrorImagesClear = 0;
    static lastGeneratedErrorImageTime = 0;
    lastAvailablePicture: Buffer;
    psos: ResponsePictureOptions[];

    constructor(public plugin: SnapshotPlugin, options: SettingsMixinDeviceOptions<Camera>) {
        super(options);
    }

    get debugConsole() {
        if (this.plugin.debugConsole)
            return this.console;
    }

    async takePictureInternal(options?: RequestPictureOptions): Promise<Buffer> {
        this.debugConsole?.log("Picture requested from camera", options);
        const eventSnapshot = options?.reason === 'event';
        const { snapshotsFromPrebuffer } = this.storageSettings.values;
        let usePrebufferSnapshots: boolean;
        switch (snapshotsFromPrebuffer) {
            case 'true':
            case 'Enabled':
                usePrebufferSnapshots = true;
                break;
            case 'Disabled':
                usePrebufferSnapshots = false;
                break;
            default:
                // default behavior is to use a prebuffer snapshot if there's no camera interface and
                // no explicit snapshot url.
                if (!this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera) && !this.storageSettings.values.snapshotUrl)
                    usePrebufferSnapshots = true;
                break;
        }

        // unifi cameras send stale snapshots which are unusable for events,
        // so force a prebuffer snapshot in this instance.
        // if prebuffer is not available, it will fall back.
        if (eventSnapshot && usePrebufferSnapshots !== false) {
            try {
                const psos = await this.getPictureOptions();
                if (psos?.[0]?.staleDuration) {
                    usePrebufferSnapshots = true;
                }
            }
            catch (e) {
            }
        }

        let takePrebufferPicture: () => Promise<Buffer>;
        const preparePrebufferSnapshot = async () => {
            if (takePrebufferPicture)
                return takePrebufferPicture;
            const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
            const msos = await realDevice.getVideoStreamOptions();
            let prebufferChannel = msos?.find(mso => mso.prebuffer);
            if (prebufferChannel || !this.lastAvailablePicture) {
                prebufferChannel = prebufferChannel || {
                    id: undefined,
                };

                const request = prebufferChannel as RequestMediaStreamOptions;
                // specify the prebuffer based on the usage. events shouldn't request
                // lengthy prebuffers as it may not contain the image it needs.
                request.prebuffer = eventSnapshot ? 1000 : 6000;
                if (this.lastAvailablePicture)
                    request.refresh = false;
                takePrebufferPicture = async () => {
                    // this.console.log('snapshotting active prebuffer');
                    return mediaManager.convertMediaObjectToBuffer(await realDevice.getVideoStream(request), 'image/jpeg');
                };
                return takePrebufferPicture;
            }
        }

        if (usePrebufferSnapshots) {
            const takePicture = await preparePrebufferSnapshot()
            if (!takePicture)
                throw new PrebufferUnavailableError();
            return takePicture();
        }

        const retryWithPrebuffer = async (e: Error) => {
            if (usePrebufferSnapshots === false)
                throw e;
            const takePicture = await preparePrebufferSnapshot()
            if (!takePicture)
                throw e;
            return takePicture();
        }

        if (this.storageSettings.values.snapshotUrl) {
            let username: string;
            let password: string;

            if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Settings)) {
                const settings = await this.mixinDevice.getSettings();
                username = settings?.find(setting => setting.key === 'username')?.value?.toString();
                password = settings?.find(setting => setting.key === 'password')?.value?.toString();
            }

            let axiosClient: AxiosDigestAuth | AxiosInstance;
            if (username && password) {
                axiosClient = new AxiosDigestAuth({
                    username,
                    password,
                });
            }
            else {
                axiosClient = axios;
            }

            try {
                const response = await axiosClient.request({
                    httpsAgent,
                    method: "GET",
                    responseType: 'arraybuffer',
                    url: this.storageSettings.values.snapshotUrl,
                    timeout: 60000,
                    headers: {
                        'Accept': 'image/*',
                    }
                });

                return response.data;
            }
            catch (e) {
                return retryWithPrebuffer(e);
            }
        }

        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)) {
            let takePictureOptions: RequestPictureOptions;
            if (!options?.id && this.storageSettings.values.defaultSnapshotChannel !== 'Camera Default') {
                try {
                    const psos = await this.getPictureOptions();
                    const pso = psos.find(pso => pso.name === this.storageSettings.values.defaultSnapshotChannel);
                    takePictureOptions = {
                        id: pso?.id,
                    };
                }
                catch (e) {
                }
            }
            try {
                return await this.mixinDevice.takePicture(takePictureOptions).then(mo => mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg'))
            }
            catch (e) {
                return retryWithPrebuffer(e);
            }
        }

        throw new Error('Snapshot Unavailable (Snapshot URL empty)');
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        let picture: Buffer;
        const eventSnapshot = options?.reason === 'event';

        try {
            picture = await this.snapshotDebouncer({
                id: options?.id,
                reason: options?.reason,
            }, async () => {
                let picture = await this.takePictureInternal();
                picture = await this.cropAndScale(picture);
                this.clearCachedPictures();
                this.currentPicture = picture;
                this.currentPictureTime = Date.now();
                this.lastAvailablePicture = picture;
                return picture;
            });
        }
        catch (e) {
            // use the fallback cached picture if it is somewhat recent.
            if (this.currentPictureTime < Date.now() - 1 * 60 * 60 * 1000)
                this.currentPicture = undefined;
            // event snapshot requests must not use cache since they're for realtime processing by homekit and nvr.
            if (eventSnapshot)
                throw e;

            if (!this.currentPicture)
                return this.createMediaObject(await this.createErrorImage(e), 'image/jpeg');

            this.console.warn('Snapshot failed, but recovered from cache', e);
            picture = this.currentPicture;
        }

        const needSoftwareResize = !!(options?.picture?.width || options?.picture?.height);
        if (needSoftwareResize) {
            try {
                picture = await this.snapshotDebouncer({
                    needSoftwareResize: true,
                    picture: options.picture,
                }, async () => {
                    this.debugConsole?.log("Resizing picture from camera", options?.picture);

                    try {
                        const mo = await mediaManager.createMediaObject(picture, 'image/jpeg');
                        const image = await mediaManager.convertMediaObject<Image>(mo, ScryptedMimeTypes.Image);
                        let { width, height } = options.picture;
                        if (!width)
                            width = height / image.height * image.width;
                        if (!height)
                            height = width / image.width * image.height;
                        return await image.toBuffer({
                            resize: {
                                width,
                                height,
                            },
                            format: 'jpg',
                        });
                    }
                    catch (e) {
                        if (!e.message?.includes('no converter found'))
                            throw e;
                    }

                    return ffmpegFilterImageBuffer(picture, {
                        console: this.debugConsole,
                        ffmpegPath: await mediaManager.getFFmpegPath(),
                        resize: options?.picture,
                        timeout: 10000,
                    });
                });
            }
            catch (e) {
                if (eventSnapshot)
                    throw e;
                return this.createMediaObject(await this.createErrorImage(e), 'image/jpeg');
            }
        }
        return this.createMediaObject(picture, 'image/jpeg');
    }

    async cropAndScale(picture: Buffer) {
        if (!this.storageSettings.values.snapshotCropScale?.length)
            return picture;

        const xmin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;
        const xmax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;

        try {
            const mo = await mediaManager.createMediaObject(picture, 'image/jpeg');
            const image = await mediaManager.convertMediaObject<Image>(mo, ScryptedMimeTypes.Image);
            const left = image.width * xmin;
            const width = image.width * (xmax - xmin);
            const top = image.height * ymin;
            const height = image.height * (ymax - ymin);

            return await image.toBuffer({
                crop: {
                    left,
                    width,
                    top,
                    height,
                },
                format: 'jpg',
            });
        }
        catch (e) {
            if (!e.message?.includes('no converter found'))
                throw e;
        }

        return ffmpegFilterImageBuffer(picture, {
            console: this.debugConsole,
            ffmpegPath: await mediaManager.getFFmpegPath(),
            crop: {
                fractional: true,
                left: xmin,
                top: ymin,
                width: xmax - xmin,
                height: ymax - ymin,
            },
            timeout: 10000,
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

        const pluginVolume = process.env.SCRYPTED_PLUGIN_VOLUME;
        const unzippedFs = path.join(pluginVolume, 'zip/unzipped/fs');
        const fontFile = path.join(unzippedFs, 'Lato-Bold.ttf');

        if (!errorBackground) {
            const black = path.join(unzippedFs, 'black.jpg');
            return ffmpegFilterImage([
                '-i', black,
            ], {
                console: this.debugConsole,
                ffmpegPath: await mediaManager.getFFmpegPath(),
                blur: true,
                text: {
                    fontFile,
                    text,
                },
                timeout: 10000,
            })
        }
        else {
            return ffmpegFilterImageBuffer(errorBackground, {
                console: this.debugConsole,
                ffmpegPath: await mediaManager.getFFmpegPath(),
                blur: true,
                brightness: -.2,
                text: {
                    fontFile,
                    text,
                },
                timeout: 10000,
            });
        }
    }

    async getPictureOptions() {
        if (!this.psos)
            this.psos = await this.mixinDevice.getPictureOptions();
        return this.psos;
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue) {
        return this.storageSettings.putSetting(key, value);
    }
}

type DimDict<T extends string> = {
    [key in T]: string;
};

export function parseDims<T extends string>(dict: DimDict<T>) {
    const ret: {
        [key in T]?: number;
    } & {
        fractional?: boolean;
    } = {
    };

    for (const t of Object.keys(dict)) {
        const val = dict[t as T];
        if (val?.endsWith('%')) {
            ret.fractional = true;
            ret[t] = parseFloat(val?.substring(0, val?.length - 1)) / 100;
        }
        else {
            ret[t] = parseFloat(val);
        }
    }
    return ret;
}

class SnapshotPlugin extends AutoenableMixinProvider implements MixinProvider, BufferConverter, Settings, DeviceProvider {
    storageSettings = new StorageSettings(this, {
        debugLogging: {
            title: 'Debug Logging',
            description: 'Debug logging for all cameras will be shown in the Snapshot Plugin Console.',
            type: 'boolean',
        }
    });

    constructor(nativeId?: string) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.FFmpegInput;
        this.toMimeType = 'image/jpeg';

        process.nextTick(() => {
            sdk.deviceManager.onDevicesChanged({
                devices: [
                    {
                        name: 'Image Writer',
                        interfaces: [
                            ScryptedInterface.BufferConverter,
                        ],
                        type: ScryptedDeviceType.Builtin,
                        nativeId: ImageWriterNativeId,
                    }
                ]
            })
        })
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId === ImageWriterNativeId)
            return new ImageWriter(ImageWriterNativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    get debugConsole() {
        if (this.storageSettings.values.debugLogging)
            return this.console;
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const mime = new MimeType(toMimeType);

        const ffmpegInput = JSON.parse(data.toString()) as FFmpegInput;

        const args = [
            ...ffmpegInput.inputArguments,
            ...(ffmpegInput.h264EncoderArguments || []),
        ];

        const {
            width,
            height,
            fractional
        } = parseDims({
            width: mime.parameters.get('width'),
            height: mime.parameters.get('height'),
        });

        const {
            left,
            top,
            right,
            bottom,
            fractional: cropFractional,
        } = parseDims({
            left: mime.parameters.get('left'),
            top: mime.parameters.get('top'),
            right: mime.parameters.get('right'),
            bottom: mime.parameters.get('bottom'),
        });

        return ffmpegFilterImage(args, {
            console: this.debugConsole,
            ffmpegPath: await mediaManager.getFFmpegPath(),
            resize: (isNaN(width) && isNaN(height))
                ? undefined
                : {
                    width,
                    height,
                    fractional,
                },
            crop: (isNaN(left) && isNaN(top) && isNaN(right) && isNaN(bottom))
                ? undefined
                : {
                    left,
                    top,
                    width: right - left,
                    height: bottom - top,
                    fractional: cropFractional,
                },
            timeout: 10000,
            time: parseFloat(mime.parameters.get('time')),
        });
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) && interfaces.includes(ScryptedInterface.VideoCamera))
            return [ScryptedInterface.Camera, ScryptedInterface.Settings];
        return undefined;
    }
    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new SnapshotMixin(this, {
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
            && interfaces.includes(ScryptedInterface.VideoCamera))
            return true;
        return false;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release()
    }
}

export default SnapshotPlugin;
