import { ScryptedInterfaceProperty, SystemDeviceState, MediaStreamUrl, VideoCamera, Camera, BufferConverter, FFMpegInput, MediaManager, MediaObject, ScryptedDevice, ScryptedInterface, ScryptedMimeTypes, SystemManager, SCRYPTED_MEDIA_SCHEME } from "@scrypted/sdk/types";
import { convert, ensureBuffer } from "../convert";
import { MediaObjectRemote } from "./plugin-api";
import mimeType from 'mime'
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import tmp from 'tmp';
import os from 'os';
import { getInstalledFfmpeg } from '@scrypted/ffmpeg'
import { ffmpegLogInitialOutput } from "../media-helpers";

function addBuiltins(console: Console, mediaManager: MediaManagerBase) {
    mediaManager.builtinConverters.push({
        fromMimeType: `${ScryptedMimeTypes.Url};${ScryptedMimeTypes.AcceptUrlParameter}=true`,
        toMimeType: ScryptedMimeTypes.FFmpegInput,
        async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            const url = data.toString();
            const args: FFMpegInput = {
                url,
                inputArguments: [
                    '-i', url,
                ],
            }

            return Buffer.from(JSON.stringify(args));
        }
    });

    mediaManager.builtinConverters.push({
        fromMimeType: ScryptedMimeTypes.FFmpegInput,
        toMimeType: ScryptedMimeTypes.MediaStreamUrl,
        async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            return data;
        }
    });

    mediaManager.builtinConverters.push({
        fromMimeType: ScryptedMimeTypes.MediaStreamUrl,
        toMimeType: ScryptedMimeTypes.FFmpegInput,
        async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            const mediaUrl: MediaStreamUrl = JSON.parse(data.toString());

            const inputArguments: string[] = [
                '-i', mediaUrl.url,
            ];

            if (mediaUrl.url.startsWith('rtsp://')) {
                inputArguments.unshift(
                    "-rtsp_transport", "tcp",
                    "-max_delay", "1000000",
                );
            }

            const ret: FFMpegInput = Object.assign({
                inputArguments,
            }, mediaUrl);

            return Buffer.from(JSON.stringify(ret));
        }
    })

    mediaManager.builtinConverters.push({
        fromMimeType: ScryptedMimeTypes.FFmpegInput,
        toMimeType: 'image/jpeg',
        async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            const ffInput: FFMpegInput = JSON.parse(data.toString());

            const args = [
                '-hide_banner',
            ];
            args.push(...ffInput.inputArguments);

            const tmpfile = tmp.fileSync();
            args.push('-y', "-vframes", "1", '-f', 'image2', tmpfile.name);

            const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
            ffmpegLogInitialOutput(console, cp);
            cp.on('error', (code) => {
                console.error('ffmpeg error code', code);
            })
            const to = setTimeout(() => {
                console.log('ffmpeg stream to image convesion timed out.');
                cp.kill('SIGKILL');
            }, 10000);
            await once(cp, 'exit');
            clearTimeout(to);
            const ret = fs.readFileSync(tmpfile.name);
            return ret;
        }
    });
}

export abstract class MediaManagerBase implements MediaManager {
    builtinConverters: BufferConverter[] = [];

    constructor(public console: Console) {
        addBuiltins(this.console, this);
    }

    abstract getSystemState(): { [id: string]: { [property: string]: SystemDeviceState } };
    abstract getDeviceById<T>(id: string): T;

    async getFFmpegPath(): Promise<string> {
        // try to get the ffmpeg path as a value of another variable
        // ie, in docker builds:
        //     export SCRYPTED_FFMPEG_PATH_ENV_VARIABLE=SCRYPTED_RASPBIAN_FFMPEG_PATH
        const v = process.env.SCRYPTED_FFMPEG_PATH_ENV_VARIABLE;
        if (v) {
            const f = process.env[v];
            if (f && fs.existsSync(f))
                return f;
        }

        // try to get the ffmpeg path from a variable
        // ie:
        //     export SCRYPTED_FFMPEG_PATH=/usr/local/bin/ffmpeg
        const f = process.env.SCRYPTED_FFMPEG_PATH;
        if (f && fs.existsSync(f))
            return f;

        const defaultPath = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        return getInstalledFfmpeg() || defaultPath;
    }

    getConverters(): BufferConverter[] {
        const converters = Object.entries(this.getSystemState())
            .filter(([id, state]) => state[ScryptedInterfaceProperty.interfaces]?.value?.includes(ScryptedInterface.BufferConverter))
            .map(([id]) => this.getDeviceById<BufferConverter>(id));
        converters.push(...this.builtinConverters);
        return converters;
    }

    ensureMediaObjectRemote(mediaObject: string | MediaObject): MediaObjectRemote {
        if (typeof mediaObject === 'string') {
            const mime = mimeType.lookup(mediaObject);
            return this.createMediaObject(mediaObject, mime);
        }
        return mediaObject as MediaObjectRemote;
    }

    async convertMediaObjectToInsecureLocalUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await convert(this.getConverters(), converted, ScryptedMimeTypes.InsecureLocalUrl);
        return url.data.toString();
    }

    async convertMediaObjectToBuffer(mediaObject: MediaObject, toMimeType: string): Promise<Buffer> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        return ensureBuffer(intermediate.data);
    }
    async convertMediaObjectToLocalUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await convert(this.getConverters(), converted, ScryptedMimeTypes.LocalUrl);
        return url.data.toString();
    }
    async convertMediaObjectToUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await convert(this.getConverters(), converted, ScryptedMimeTypes.Url);
        return url.data.toString();
    }

    createFFmpegMediaObject(ffMpegInput: FFMpegInput): MediaObject {
        return this.createMediaObject(Buffer.from(JSON.stringify(ffMpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    createMediaObject(data: string | Buffer | Promise<string | Buffer>, mimeType?: string): MediaObjectRemote {
        class MediaObjectImpl implements MediaObjectRemote {
            __proxy_props = {
                mimeType,
            }

            mimeType = mimeType;
            async getData(): Promise<Buffer | string> {
                return Promise.resolve(data);
            }
        }
        return new MediaObjectImpl();
    }

    async createMediaObjectFromUrl(data: string, mimeType?: string): Promise<MediaObject> {
        if (!data.startsWith(SCRYPTED_MEDIA_SCHEME))
            return this.createMediaObject(data, mimeType || ScryptedMimeTypes.Url);

        const url = new URL(data.toString());
        const id = url.hostname;
        const path = url.pathname.split('/')[1];
        let mo: MediaObject;
        if (path === ScryptedInterface.VideoCamera) {
            mo = await this.getDeviceById<VideoCamera>(id).getVideoStream();
        }
        else if (path === ScryptedInterface.Camera) {
            mo = await this.getDeviceById<Camera>(id).takePicture() as any;
        }
        else {
            throw new Error('Unrecognized Scrypted Media interface.')
        }

        return mo;
    }
}

export class MediaManagerImpl extends MediaManagerBase {
    constructor(public systemManager: SystemManager, console: Console) {
        super(console);
    }

    getSystemState(): { [id: string]: { [property: string]: SystemDeviceState; }; } {
        return this.systemManager.getSystemState();
    }

    getDeviceById<T>(id: string): T {
        return this.systemManager.getDeviceById<T>(id);
    }
}

export class MediaManagerHostImpl extends MediaManagerBase {
    constructor(public systemState: { [id: string]: { [property: string]: SystemDeviceState } },
        public getDeviceById: (id: string) => any,
        console: Console) {
        super(console);
    }

    getSystemState(): { [id: string]: { [property: string]: SystemDeviceState; }; } {
        return this.systemState;
    }
}
