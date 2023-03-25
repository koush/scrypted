import { Deferred } from "@scrypted/common/src/deferred";
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import { readLength, readLine } from "@scrypted/common/src/read-stream";
import { addVideoFilterArguments } from "@scrypted/common/src/ffmpeg-helpers";
import sdk, { FFmpegInput, Image, ImageOptions, MediaObject, ScryptedDeviceBase, ScryptedMimeTypes, VideoFrame, VideoFrameGenerator, VideoFrameGeneratorOptions } from "@scrypted/sdk";
import child_process from 'child_process';
import sharp from 'sharp';
import { Readable } from 'stream';

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
    constructor(public image: sharp.Sharp, public width: number, public height: number) {
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
        if (options?.format === 'rgb') {
            transformed.removeAlpha().toFormat('raw');
        }
        else if (options?.format === 'jpg') {
            transformed.toFormat('jpg');
        }
        return transformed.toBuffer();
    }

    async toVipsImage(options: ImageOptions) {
        const transformed = this.toImageInternal(options);
        const { info, data } = await transformed.raw().toBuffer({
            resolveWithObject: true,
        });

        const newImage = sharp(data, {
            raw: info,
        });

        const newMetadata = await newImage.metadata();
        const newVipsImage = new VipsImage(newImage, newMetadata.width, newMetadata.height);
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
        const args = [
            '-hide_banner',
            //'-hwaccel', 'auto',
            ...ffmpegInput.inputArguments,
            '-vcodec', 'pam',
            '-pix_fmt', 'rgb24',
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


                    if (headers['TUPLTYPE'] !== 'RGB')
                        throw new Error(`Unexpected TUPLTYPE in PAM stream: ${headers['TUPLTYPE']}`);

                    const width = parseInt(headers['WIDTH']);
                    const height = parseInt(headers['HEIGHT']);
                    if (!width || !height)
                        throw new Error('Invalid dimensions in PAM stream');

                    const length = width * height * 3;
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
                        this.console.warn('skipped frame');
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

                const image = sharp(data, {
                    raw: {
                        width,
                        height,
                        channels: 3,
                    }
                });
                const vipsImage = new VipsImage(image, width, height);
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
