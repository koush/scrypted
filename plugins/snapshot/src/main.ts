import { AutoenableMixinProvider } from "@scrypted/common/src/autoenable-mixin-provider";
import { AuthFetchCredentialState, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { RefreshPromise, TimeoutError, createMapPromiseDebouncer, singletonPromise, timeoutPromise } from "@scrypted/common/src/promise-utils";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import sdk, { BufferConverter, Camera, DeviceManifest, DeviceProvider, FFmpegInput, HttpRequest, HttpRequestHandler, HttpResponse, MediaObject, MediaObjectOptions, MixinProvider, RequestMediaStreamOptions, RequestPictureOptions, ResponsePictureOptions, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, SettingValue, Settings, Sleep, VideoCamera, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import https from 'https';
import os from 'os';
import path from 'path';
import url from 'url';
import { ffmpegFilterImage, ffmpegFilterImageBuffer } from './ffmpeg-image-filter';
import { ImageConverter, ImageConverterNativeId } from './image-converter';
import { ImageReader, ImageReaderNativeId, loadSharp, loadVipsImage } from './image-reader';
import { ImageWriter, ImageWriterNativeId } from './image-writer';

const { mediaManager, systemManager } = sdk;
if (os.cpus().find(cpu => cpu.model?.toLowerCase().includes('qemu'))) {
    sdk.log.a('QEMU CPU detected. Set your CPU model to host.');
}

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
    snapshotDebouncer = createMapPromiseDebouncer<{
        picture: Buffer;
        pictureTime: number;
    }>();
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

    async takePictureInternal(id: string, eventSnapshot: boolean): Promise<Buffer> {
        this.debugConsole?.log("Picture requested from camera", { id, eventSnapshot });
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

        const realDevice = systemManager.getDeviceById<VideoCamera & Sleep>(this.id);

        let takePrebufferPicture: () => Promise<Buffer>;
        const preparePrebufferSnapshot = async () => {
            if (takePrebufferPicture)
                return takePrebufferPicture;
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
                    const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(await realDevice.getVideoStream(request), ScryptedMimeTypes.FFmpegInput);
                    return ffmpegFilterImage(ffmpegInput.inputArguments, {
                        console: this.debugConsole,
                        ffmpegPath: await mediaManager.getFFmpegPath(),
                        timeout: 10000,
                    });
                };
                return takePrebufferPicture;
            }
        }

        if (usePrebufferSnapshots) {
            const takePicture = await preparePrebufferSnapshot()
            if (!takePicture) {
                this.debugConsole?.warn('Prebuffer snapshot was requested but prebuffer is unavailable.');
                throw new PrebufferUnavailableError();
            }
            return takePicture();
        }

        const retryWithPrebuffer = async (e: Error) => {
            if (usePrebufferSnapshots === false)
                throw e;
            const takePicture = await preparePrebufferSnapshot()
            if (!takePicture)
                throw e;
            this.console.error('Snapshot failed, falling back to prebuffer', e);
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

            let credential: AuthFetchCredentialState;
            if (username && password) {
                credential = {
                    username,
                    password,
                };
            }

            try {
                const response = await authHttpFetch({
                    rejectUnauthorized: false,
                    url: this.storageSettings.values.snapshotUrl,
                    credential,
                    timeout: 60000,
                    headers: {
                        'Accept': 'image/*',
                    },
                });

                return response.body;
            }
            catch (e) {
                return retryWithPrebuffer(e);
            }
        }

        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)) {
            let takePictureOptions: RequestPictureOptions;
            if (!id && this.storageSettings.values.defaultSnapshotChannel !== 'Camera Default') {
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
                // consider waking the camera if 
                if (!eventSnapshot && this.mixinDeviceInterfaces.includes(ScryptedInterface.Sleep) && realDevice.sleeping) {
                    this.console.log('Not waking sleeping camera for periodic snapshot.');
                    return this.lastAvailablePicture;
                }

                return await this.mixinDevice.takePicture(takePictureOptions).then(mo => mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg'))
            }
            catch (e) {
                return retryWithPrebuffer(e);
            }
        }

        throw new Error('Snapshot Unavailable (Snapshot URL empty)');
    }

    async takePictureRaw(options?: RequestPictureOptions): Promise<Buffer> {
        const eventSnapshot = options?.reason === 'event';
        const periodicSnapshot = options?.reason === 'periodic';
        const hoursDuration = this.mixinDeviceInterfaces.includes(ScryptedInterface.Sleep) ? 5 : 1;

        // clear out snapshots that are too old.
        if (this.currentPictureTime < Date.now() - hoursDuration * 60 * 60 * 1000)
            this.currentPicture = undefined;

        // always grab/debounce a snapshot
        // event snapshot are special and should immediately expire.
        // other snapshots may be debounced for 4s.
        const debounced = this.snapshotDebouncer({
            id: options?.id,
            type: 'source',
            event: options?.reason === 'event',
        }, eventSnapshot ? 0 : 4000, async () => {
            const snapshotTimer = Date.now();
            let picture = await this.takePictureInternal(undefined, eventSnapshot);
            picture = await this.cropAndScale(picture);
            this.clearCachedPictures();
            const pictureTime = Date.now();
            this.currentPicture = picture;
            this.currentPictureTime = pictureTime;
            this.lastAvailablePicture = picture;
            this.debugConsole?.debug(`Periodic snapshot took ${(this.currentPictureTime - snapshotTimer) / 1000} seconds to retrieve.`)
            return {
                picture,
                pictureTime,
            };
        });
        debounced.catch(() => { });

        // prevent this from expiring
        let availablePicture = this.currentPicture;
        let availablePictureTime = this.currentPictureTime;

        let rawPicture: Awaited<typeof debounced>;
        try {
            let pictureTimeout = options?.timeout;
            if (!pictureTimeout) {
                // determine a fetch timeout based on the reason and staleness
                const allowedSnapshotStaleness = eventSnapshot ? 0 : periodicSnapshot ? 20000 : 10000;
                if (!availablePicture) {
                    // none available so wait a while
                    pictureTimeout = 10000;
                }
                else {
                    if (availablePictureTime > Date.now() - 3000) {
                        // very recent, don't wait for too long
                        pictureTimeout = 1000;
                    }
                    else if (availablePictureTime > Date.now() - allowedSnapshotStaleness) {
                        // fairly recent so give it little time to get a fresh one
                        // idr interval is typically 4000 for reference
                        pictureTimeout = 3000;
                    }
                    else {
                        // stale so wait a while
                        pictureTimeout = 10000;
                    }
                }
            }
            rawPicture = await timeoutPromise(pictureTimeout, debounced);
        }
        catch (e) {
            // a best effort was made to get a recent snapshot from cache or from a camera request,
            // the cache request will never fail, but if the camera request fails,
            // it may be ok to use a somewhat stale snapshot depending on reason.

            // event snapshot requests must not use cache since they're for realtime processing by homekit and nvr.
            if (eventSnapshot)
                throw e;

            if (this.currentPicture) {
                // use the current picture if it is still available as it may be newer.
                availablePicture = this.currentPicture;
                availablePictureTime = this.currentPictureTime;
            }

            if (!availablePicture)
                return this.createErrorImage(e);

            this.console.warn('Snapshot failed, but recovered from cache', e);
            rawPicture = {
                picture: availablePicture,
                pictureTime: availablePictureTime,
            };

            // gc
            availablePicture = undefined;
        }

        const needSoftwareResize = !!(options?.picture?.width || options?.picture?.height) && this.storageSettings.values.snapshotResolution !== 'Full Resolution';

        if (!needSoftwareResize)
            return rawPicture.picture;

        try {
            const key = {
                type: 'resize',
                pictureTime: rawPicture.pictureTime,
                needSoftwareResize: true,
                picture: options.picture,
            };
            const ret = await this.snapshotDebouncer(key, 10000, async () => {
                this.debugConsole?.log("Resizing picture from camera", key);

                if (loadSharp()) {
                    const vips = await loadVipsImage(rawPicture.picture, this.id);
                    try {
                        const ret = await vips.toBuffer({
                            resize: options?.picture,
                            format: 'jpg',
                        });
                        return {
                            picture: ret,
                            pictureTime: rawPicture.pictureTime,
                        };
                    }
                    finally {
                        vips.close();
                    }
                }

                const ret = await ffmpegFilterImageBuffer(rawPicture.picture, {
                    console: this.debugConsole,
                    ffmpegPath: await mediaManager.getFFmpegPath(),
                    resize: options?.picture,
                    timeout: 10000,
                });
                return {
                    picture: ret,
                    pictureTime: rawPicture.pictureTime,
                };
            });

            return ret.picture;
        }
        catch (e) {
            if (eventSnapshot)
                throw e;
            return this.createErrorImage(e);
        }
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        return this.createMediaObject(await this.takePictureRaw(options), 'image/jpeg');
    }

    async cropAndScale(picture: Buffer) {
        if (!this.storageSettings.values.snapshotCropScale?.length)
            return picture;

        const xmin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymin = Math.min(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;
        const xmax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => x)) / 100;
        const ymax = Math.max(...this.storageSettings.values.snapshotCropScale.map(([x, y]) => y)) / 100;

        if (loadSharp()) {
            const vips = await loadVipsImage(picture, this.id);
            try {
                const ret = await vips.toBuffer({
                    crop: {
                        left: xmin * vips.width,
                        top: ymin * vips.height,
                        width: (xmax - xmin) * vips.width,
                        height: (ymax - ymin) * vips.height,
                    },
                    format: 'jpg',
                });
                return ret;
            }
            finally {
                vips.close();
            }
        }

        // try {
        //     const mo = await mediaManager.createMediaObject(picture, 'image/jpeg');
        //     const image = await mediaManager.convertMediaObject<Image>(mo, ScryptedMimeTypes.Image);
        //     const left = image.width * xmin;
        //     const width = image.width * (xmax - xmin);
        //     const top = image.height * ymin;
        //     const height = image.height * (ymax - ymin);

        //     return await image.toBuffer({
        //         crop: {
        //             left,
        //             width,
        //             top,
        //             height,
        //         },
        //         format: 'jpg',
        //     });
        // }
        // catch (e) {
        //     if (!e.message?.includes('no converter found'))
        //         throw e;
        // }

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
            this.console.error('Snapshot failed', e);
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
            return ffmpegFilterImage([
                '-f', 'lavfi',
                '-i', 'color=black:size=1920x1080',
            ], {
                console: this.debugConsole,
                ffmpegPath: await mediaManager.getFFmpegPath(),
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

export class SnapshotPlugin extends AutoenableMixinProvider implements MixinProvider, BufferConverter, Settings, DeviceProvider, HttpRequestHandler {
    storageSettings = new StorageSettings(this, {
        debugLogging: {
            title: 'Debug Logging',
            description: 'Debug logging for all cameras will be shown in the Snapshot Plugin Console.',
            type: 'boolean',
        },
    });
    mixinDevices = new Map<string, SnapshotMixin>();
    authenticatedPath = sdk.endpointManager.getAuthenticatedPath(this.nativeId)

    constructor(nativeId?: string) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.SchemePrefix + 'scrypted-media' + ';converter-weight=0';
        this.toMimeType = ScryptedMimeTypes.LocalUrl;

        const manifest: DeviceManifest = {
            devices: [
                {
                    name: 'Image Writer',
                    interfaces: [
                        ScryptedInterface.BufferConverter,
                    ],
                    type: ScryptedDeviceType.Internal,
                    nativeId: ImageWriterNativeId,
                },
                {
                    name: 'Image Converter',
                    interfaces: [
                        ScryptedInterface.BufferConverter,
                    ],
                    type: ScryptedDeviceType.Internal,
                    nativeId: ImageConverterNativeId,
                }
            ],
        };

        if (loadSharp()) {
            manifest.devices.push(
                {
                    name: 'Image Reader',
                    interfaces: [
                        ScryptedInterface.BufferConverter,
                    ],
                    type: ScryptedDeviceType.Internal,
                    nativeId: ImageReaderNativeId,
                }
            );
        }

        process.nextTick(() => {
            sdk.deviceManager.onDevicesChanged(manifest)
        });
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId === ImageConverterNativeId)
            return new ImageConverter(this, ImageConverterNativeId);
        if (nativeId === ImageWriterNativeId)
            return new ImageWriter(ImageWriterNativeId);
        if (nativeId === ImageReaderNativeId)
            return new ImageReader(ImageReaderNativeId);
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

    async getLocalSnapshot(id: string, iface: string, search: string) {
        const endpoint = await this.authenticatedPath;
        const ret = url.resolve(path.join(endpoint, id, iface, `${Date.now()}.jpg`) + `${search}`, '');
        return Buffer.from(ret);
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const url = new URL(data.toString());
        const id = url.hostname;
        const path = url.pathname.split('/')[1];

        if (path === ScryptedInterface.Camera) {
            return this.getLocalSnapshot(id, path, url.search);
        }
        if (path === ScryptedInterface.VideoCamera) {
            return this.getLocalSnapshot(id, path, url.search);
        }
        else {
            throw new Error('Unrecognized Scrypted Media interface.')
        }
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.isPublicEndpoint) {
            response.send('', {
                code: 404,
            });
            return;
        }

        const pathname = request.url.substring(request.rootPath.length);
        const [_, id, iface] = pathname.split('/');
        try {
            if (iface !== ScryptedInterface.Camera && iface !== ScryptedInterface.VideoCamera)
                throw new Error();

            const search = new URLSearchParams(pathname.split('?')[1]);
            const mixin = this.mixinDevices.get(id);
            let buffer: Buffer;
            let timeout = parseInt(search.get('timeout'));
            // make web requests timeout after 5 seconds by default.
            if (isNaN(timeout))
                timeout = 5000;
            const rpo: RequestPictureOptions = {
                reason: search.get('reason') as 'event' | 'periodic',
                timeout,
                picture: {
                    width: parseInt(search.get('width')) || undefined,
                    height: parseInt(search.get('height')) || undefined,
                }
            };

            if (mixin?.storageSettings.values.snapshotResolution === 'Full Resolution')
                delete rpo.picture;

            if (mixin && iface === ScryptedInterface.Camera) {
                buffer = await mixin.takePictureRaw(rpo)
            }
            else {
                const device = systemManager.getDeviceById<Camera & VideoCamera>(id);
                const picture = iface === ScryptedInterface.Camera ? await device.takePicture(rpo) : await device.getVideoStream();
                buffer = await mediaManager.convertMediaObjectToBuffer(picture, 'image/jpeg');
            }

            response.send(buffer, {
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'max-age=10',
                }
            });
        }
        catch (e) {
            this.debugConsole?.error('snapshot http request failed', e);
            response.send('', {
                code: 500,
            });
        }
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) && interfaces.includes(ScryptedInterface.VideoCamera))
            return [ScryptedInterface.Camera, ScryptedInterface.Settings];
        return undefined;
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        const ret = new SnapshotMixin(this, {
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
            group: 'Snapshot',
            groupKey: 'snapshot',
        });
        this.mixinDevices.set(ret.id, ret);
        return ret;
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
        if (this.mixinDevices.get(id) === mixinDevice)
            this.mixinDevices.delete(id);
        await mixinDevice.release()
    }
}

export default SnapshotPlugin;
