import { Deferred } from "@scrypted/common/src/deferred";
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import { readLength, readLine } from "@scrypted/common/src/read-stream";
import sdk, { FFmpegInput, Image, ImageFormat, ImageOptions, MediaObject, ScryptedDeviceBase, ScryptedMimeTypes, VideoFrame, VideoFrameGenerator, VideoFrameGeneratorOptions } from "@scrypted/sdk";
import child_process from 'child_process';
import { Readable } from 'stream';


interface RawFrame {
    width: number;
    height: number;
    data: Buffer;
}

async function createRawImageMediaObject(image: RawImage): Promise<Image & MediaObject> {
    const ret = await sdk.mediaManager.createMediaObject(image, ScryptedMimeTypes.Image, {
        format: null,
        width: image.width,
        height: image.height,
        toBuffer: (options: ImageOptions) => image.toBuffer(options),
        toImage: (options: ImageOptions) => image.toImage(options),
        close: () => image.close(),
    });

    return ret;
}

class RawImage implements Image, RawFrame {
    constructor(public data: Buffer, public width: number, public height: number, public format: ImageFormat) {
    }

    async close(): Promise<void> {
        this.data = undefined;
    }

    checkOptions(options: ImageOptions) {
        if (options?.resize || options?.crop || (options?.format && options?.format !== this.format))
            throw new Error('resize, crop, and color conversion are not supported. Install the Python Codecs plugin if it is missing, and ensure FFmpeg Frame Generator is not selected.');
    }

    async toBuffer(options: ImageOptions) {
        this.checkOptions(options);
        return this.data;
    }

    async toImage(options: ImageOptions) {
        this.checkOptions(options);
        return createRawImageMediaObject(this);
    }
}

export class FFmpegVideoFrameGenerator extends ScryptedDeviceBase implements VideoFrameGenerator {
    async *generateVideoFramesInternal(mediaObject: MediaObject, options?: VideoFrameGeneratorOptions): AsyncGenerator<VideoFrame, any, unknown> {
        const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(mediaObject, ScryptedMimeTypes.FFmpegInput);
        const gray = options?.format === 'gray';
        const format = options?.format || 'rgb';
        const channels = gray ? 1 : (format === 'rgb' ? 3 : 4);
        const vf: string[] = [];
        if (options?.fps)
            vf.push(`fps=${options.fps}`);
        if (options.resize)
            vf.push(`scale=${options.resize.width}:${options.resize.height}`);
        const args = [
            '-hide_banner',
            //'-hwaccel', 'auto',
            ...ffmpegInput.inputArguments,
            '-vcodec', 'pam',
            '-pix_fmt', gray ? 'gray' : (format === 'rgb' ? 'rgb24' : 'rgba'),
            ...vf.length ? [
                '-vf',
                vf.join(','),
            ] : [],
            '-f', 'image2pipe',
            'pipe:3',
        ];

        // this seems to reduce latency.
        // addVideoFilterArguments(args, 'fps=10', 'fps');

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


                    if (headers['TUPLTYPE'] !== 'RGB' && headers['TUPLTYPE'] !== 'RGB_ALPHA' && headers['TUPLTYPE'] !== 'GRAYSCALE')
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
            const flush = async () => { };

            while (!finished) {
                frameDeferred = new Deferred();
                const raw = await frameDeferred.promise;
                const { width, height, data } = raw;

                const rawImage = new RawImage(data, width, height, format);
                try {
                    const image = await createRawImageMediaObject(rawImage);
                    yield {
                        __json_copy_serialize_children: true,
                        timestamp: 0,
                        queued: 0,
                        image,
                        flush,
                    };
                }
                finally {
                    rawImage.data = undefined;
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


    async generateVideoFrames(mediaObject: MediaObject, options?: VideoFrameGeneratorOptions): Promise<AsyncGenerator<VideoFrame, any, unknown>> {
        return this.generateVideoFramesInternal(mediaObject, options);
    }
}
