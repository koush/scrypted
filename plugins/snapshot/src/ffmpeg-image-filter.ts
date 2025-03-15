import { addVideoFilterArguments } from '@scrypted/common/src/ffmpeg-helpers';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import { timeoutFunction } from '@scrypted/common/src/promise-utils';
import { sleep } from '@scrypted/common/src/sleep';
import child_process, { ChildProcess } from 'child_process';
import { once } from 'events';
import { Writable } from 'stream';
import { Pipe2Jpeg } from './pipe2jpeg';

const defaultFfmpegImageArgs = [
    '-hide_banner',
    '-hwaccel', 'none',
    '-err_detect', 'aggressive',
    '-fflags', 'discardcorrupt',
    '-y',
];

export interface FFmpegImageFilterOptions {
    console?: Console,
    blur?: boolean;
    brightness?: number;
    ffmpegPath?: string;
    text?: {
        text: string;
        fontFile: string;
    };
    timeout?: number;

    resize?: {
        fractional?: boolean;
        width?: number;
        height?: number;
    };

    crop?: {
        fractional?: boolean;
        left: number;
        top: number;
        width: number;
        height: number;
    };

    time?: number;
}

function ffmpegCreateOutputArguments(inputArguments: string[], options: FFmpegImageFilterOptions) {
    if (options.crop) {
        const { crop } = options;

        const left = crop.fractional ? `iw*${crop.left}` : crop.left;
        const top = crop.fractional ? `ih*${crop.top}` : crop.top;
        const width = crop.fractional ? `iw*${crop.width}` : crop.width;
        const height = crop.fractional ? `ih*${crop.height}` : crop.height;

        const filter = `crop=${width}:${height}:${left}:${top}`;
        addVideoFilterArguments(inputArguments, filter, 'snapshotCrop');
    }

    // favor height, and always respect aspect ratio.
    if (options.resize?.width || options.resize?.height) {
        const { resize } = options;
        let width: string | number;
        let height: string | number;

        if (!resize.height) {
            height = -2;
            width = resize.fractional ? `iw*${resize.width}` : `'min(${resize.width},iw)'`;
        }
        else {
            width = -2;
            height = resize.fractional ? `ih*${resize.height}` : `'min(${resize.height},ih)'`;
        }

        const filter = `scale=${width}:${height}`;
        addVideoFilterArguments(inputArguments, filter, 'snapshotResize');
    }

    if (options.brightness) {
        addVideoFilterArguments(inputArguments, `eq=brightness=${options.brightness}`, 'snapshotEq');
    }

    if (options.blur) {
        addVideoFilterArguments(inputArguments, 'gblur=sigma=25', 'snapshotBlur');
    }

    if (options.text) {
        const { text } = options;
        addVideoFilterArguments(inputArguments,
            `drawtext=fontfile=${text.fontFile}:text='${text.text}':fontcolor=white:fontsize=h/8:x=(w-text_w)/2:y=(h-text_h)/2`,
            'snapshotText');
    }

    // if (options)
    //     console.log('input arguments', inputArguments);
}

export function ffmpegFilterImageBuffer(inputJpeg: Buffer, options: FFmpegImageFilterOptions) {
    const inputArguments = [
        '-f', 'image2pipe',
        '-i', 'pipe:4',
    ];

    ffmpegCreateOutputArguments(inputArguments, options);
    const outputArguments = [
        '-frames:v', '1',
        '-f', 'image2',
        'pipe:3',
    ];
    const args: string[] = [
        ...defaultFfmpegImageArgs,

        ...inputArguments,

        ...outputArguments,
    ];

    safePrintFFmpegArguments(options.console, args);
    const cp = child_process.spawn(options.ffmpegPath || 'ffmpeg',
        args, {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    });
    ffmpegLogInitialOutput(options.console, cp);

    const input = cp.stdio[4] as Writable;
    input.write(inputJpeg);
    input.end();

    return ffmpegFilterImageInternal(cp, options);
}

export function ffmpegFilterImage(inputArguments: string[], options: FFmpegImageFilterOptions) {
    ffmpegCreateOutputArguments(inputArguments, options);

    let outputArguments: string[];
    if (options.time) {
        outputArguments = [
            '-vsync', '0',
            '-f', 'image2pipe',
            'pipe:3',
        ];
    }
    else {
        outputArguments = [
            // ensure it is an iframe. decoding h265 can result in corrupt p frames being decoded.
            // which is weird, why doesnt ffmpeg skip it?
            '-vf', "select='eq(pict_type\,I)'",
            '-frames:v', '1',
            '-f', 'image2',
            'pipe:3',
        ];
    }

    const args: string[] = [
        ...defaultFfmpegImageArgs,

        ...inputArguments,

        ...outputArguments,
    ];

    // console.log(args);

    safePrintFFmpegArguments(options.console, args);
    const cp = child_process.spawn(options.ffmpegPath || 'ffmpeg',
        args, {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    ffmpegLogInitialOutput(options.console, cp);

    if (options.time)
        return ffmpegFilterImageStream(cp, options);
    else
        return ffmpegFilterImageInternal(cp, options);
}

export async function ffmpegFilterImageInternal(cp: ChildProcess, options: FFmpegImageFilterOptions) {
    const buffers: Buffer[] = [];
    cp.stdio[3].on('data', data => buffers.push(data));

    try {
        await timeoutFunction(options.timeout || 10000, async () => {
            const exit = once(cp, 'exit');
            await once(cp.stdio[3], 'end').catch(() => { });
            const [exitCode] = await exit;
            if (exitCode)
                throw new Error(`ffmpeg input to image conversion failed with exit code: ${exitCode}, ${cp.spawnargs.join(' ')}`);
        });
    }
    catch (e) {
        if (!buffers.length)
            throw e;
    }
    finally {
        safeKillFFmpeg(cp);
    }

    return Buffer.concat(buffers);
}

export async function ffmpegFilterImageStream(cp: ChildProcess, options: FFmpegImageFilterOptions) {
    try {
        return await timeoutFunction(options.timeout || 10000, async () => {
            const pipe = cp.stdio[3].pipe(new Pipe2Jpeg());
            let last: Buffer;
            let count = 0;
            pipe.on('jpeg', jpeg => {
                ++count;
                last = jpeg;
            });

            await once(pipe, 'jpeg');
            await Promise.any([once(cp, 'exit'), sleep(options.time)]).catch(() => {});
            if (!last)
                throw new Error(`ffmpeg stream to image conversion failed with exit code: ${cp.exitCode}, ${cp.spawnargs.join(' ')}`);
            return last;
        });
    }
    finally {
        safeKillFFmpeg(cp);
    }
}
