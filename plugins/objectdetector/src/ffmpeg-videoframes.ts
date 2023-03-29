import { Deferred } from "@scrypted/common/src/deferred";
import { addVideoFilterArguments } from "@scrypted/common/src/ffmpeg-helpers";
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import { readLength, readLine } from "@scrypted/common/src/read-stream";
import sdk, { FFmpegInput, Image, ImageOptions, MediaObject, ScryptedDeviceBase, ScryptedMimeTypes, VideoFrame, VideoFrameGenerator, VideoFrameGeneratorOptions } from "@scrypted/sdk";
import child_process from 'child_process';
import type sharp from 'sharp';
import { Readable } from 'stream';

export let sharpLib: (input?:
    | Buffer
    | Uint8Array
    | Uint8ClampedArray
    | Int8Array
    | Uint16Array
    | Int16Array
    | Uint32Array
    | Int32Array
    | Float32Array
    | Float64Array
    | string,
    options?: sharp.SharpOptions) => sharp.Sharp;
try {
    sharpLib = require('sharp');
}
catch (e) {
    console.warn('Sharp failed to load. FFmpeg Frame Generator will not function properly.')
}

async function createVipsMediaObject(image: VipsImage): Promise<VideoFrame & MediaObject> {
    const ret = await sdk.mediaManager.createMediaObject(image, ScryptedMimeTypes.Image, {
        format: null,
        timestamp: 0,
        width: image.width,
        height: image.height,
        toBuffer: (options: ImageOptions) => image.toBuffer(options),
        toImage: async (options: ImageOptions) => {
            const newImage = await image.toVipsImage(options);
            return createVipsMediaObject(newImage);
        }
    });

    return ret;
}

interface RawFrame {
    width: number;
    height: number;
    data: Buffer;
}

class VipsImage implements Image {
    constructor(public image: sharp.Sharp, public width: number, public height: number, public channels: number) {
    }

    toImageInternal(options: ImageOptions) {
        const transformed = this.image.clone();
        if (options?.crop) {
            transformed.extract({
                left: Math.floor(options.crop.left),
                top: Math.floor(options.crop.top),
                width: Math.floor(options.crop.width),
                height: Math.floor(options.crop.height),
            });
        }
        if (options?.resize) {
            transformed.resize(typeof options.resize.width === 'number' ? Math.floor(options.resize.width) : undefined, typeof options.resize.height === 'number' ? Math.floor(options.resize.height) : undefined, {
                fit: "fill",
                kernel: 'cubic',
            });
        }

        return transformed;
    }

    async toBuffer(options: ImageOptions) {
        const transformed = this.toImageInternal(options);
        if (options?.format === 'jpg') {
            transformed.toFormat('jpg');
        }
        else {
            if (this.channels === 1 && (options?.format === 'gray' || !options.format))
                transformed.extractChannel(0);
            else if (options?.format === 'gray')
                transformed.toColorspace('b-w');
            else if (options?.format === 'rgb')
                transformed.removeAlpha()
            transformed.raw();
        }
        return transformed.toBuffer();
    }

    async toVipsImage(options: ImageOptions) {
        const transformed = this.toImageInternal(options);
        const { info, data } = await transformed.raw().toBuffer({
            resolveWithObject: true,
        });

        const sharpLib = require('sharp') as (input?:
            | Buffer
            | Uint8Array
            | Uint8ClampedArray
            | Int8Array
            | Uint16Array
            | Int16Array
            | Uint32Array
            | Int32Array
            | Float32Array
            | Float64Array
            | string,
            options?) => sharp.Sharp;
        const newImage = sharpLib(data, {
            raw: info,
        });

        const newMetadata = await newImage.metadata();
        const newVipsImage = new VipsImage(newImage, newMetadata.width, newMetadata.height, newMetadata.channels);
        return newVipsImage;
    }

    async toImage(options: ImageOptions) {
        if (options.format)
            throw new Error('format can only be used with toBuffer');
        const newVipsImage = await this.toVipsImage(options);
        return createVipsMediaObject(newVipsImage);
    }
}

export class FFmpegVideoFrameGenerator extends ScryptedDeviceBase implements VideoFrameGenerator {
    async *generateVideoFramesInternal(mediaObject: MediaObject, options?: VideoFrameGeneratorOptions, filter?: (videoFrame: VideoFrame & MediaObject) => Promise<boolean>): AsyncGenerator<VideoFrame & MediaObject, any, unknown> {
        const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(mediaObject, ScryptedMimeTypes.FFmpegInput);
        const gray = options?.format === 'gray';
        const channels = gray ? 1 : 3;
        const args = [
            '-hide_banner',
            //'-hwaccel', 'auto',
            ...ffmpegInput.inputArguments,
            '-vcodec', 'pam',
            '-pix_fmt', gray ? 'gray' : 'rgb24',
            '-f', 'image2pipe',
            'pipe:3',
        ];

        // this seems to reduce latency.
        addVideoFilterArguments(args, 'fps=10', 'fps');

        const cp = child_process.spawn(await sdk.mediaManager.getFFmpegPath(), args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        const console = mediaObject?.sourceId ? sdk.deviceManager.getMixinConsole(mediaObject.sourceId) : this.console;
        safePrintFFmpegArguments(console, args);
        ffmpegLogInitialOutput(console, cp);

        let finished = false;
        let frameDeferred: Deferred<RawFrame>;

        const reader = async () => {
            try {

                const readable = cp.stdio[3] as Readable;
                const headers = new Map<string, string>();
                while (!finished) {
                    const line = await readLine(readable);
                    if (line !== 'ENDHDR') {
                        const [key, value] = line.split(' ');
                        headers[key] = value;
                        continue;
                    }


                    if (headers['TUPLTYPE'] !== 'RGB' && headers['TUPLTYPE'] !== 'GRAYSCALE')
                        throw new Error(`Unexpected TUPLTYPE in PAM stream: ${headers['TUPLTYPE']}`);

                    const width = parseInt(headers['WIDTH']);
                    const height = parseInt(headers['HEIGHT']);
                    if (!width || !height)
                        throw new Error('Invalid dimensions in PAM stream');

                    const length = width * height * channels;
                    headers.clear();
                    const data = await readLength(readable, length);

                    if (frameDeferred) {
                        const f = frameDeferred;
                        frameDeferred = undefined;
                        f.resolve({
                            width,
                            height,
                            data,
                        });
                    }
                    else {
                        // this.console.warn('skipped frame');
                    }
                }
            }
            catch (e) {
            }
            finally {
                console.log('finished reader');
                finished = true;
                frameDeferred?.reject(new Error('frame generator finished'));
            }
        }

        try {
            reader();
            while (!finished) {
                frameDeferred = new Deferred();
                const raw = await frameDeferred.promise;
                const { width, height, data } = raw;

                const image = sharpLib(data, {
                    raw: {
                        width,
                        height,
                        channels,
                    }
                });
                const vipsImage = new VipsImage(image, width, height, channels);
                try {
                    const mo = await createVipsMediaObject(vipsImage);
                    yield mo;
                }
                finally {
                    vipsImage.image = undefined;
                    image.destroy();
                }
            }
        }
        catch (e) {
        }
        finally {
            console.log('finished generator');
            finished = true;
            safeKillFFmpeg(cp);
        }
    }


    async generateVideoFrames(mediaObject: MediaObject, options?: VideoFrameGeneratorOptions, filter?: (videoFrame: VideoFrame & MediaObject) => Promise<boolean>): Promise<AsyncGenerator<VideoFrame & MediaObject, any, unknown>> {
        return this.generateVideoFramesInternal(mediaObject, options, filter);
    }
}
