import sdk, { FFmpegInput, RecordingStreamThumbnailOptions } from '@scrypted/sdk';
import url from 'url';
import type { MIMETypeParameters } from 'whatwg-mimetype';
import { FFmpegImageFilterOptions, ffmpegFilterImage, ffmpegFilterImageBuffer } from './ffmpeg-image-filter';
import { loadSharp, loadVipsImage } from './image-reader';

export type DimDict<T extends string> = {
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
            ret[t] = val ? parseFloat(val) : undefined;
        }
    }
    return ret;
}

export interface ImageOp {
    resize?: ReturnType<typeof parseDims<'width' | 'height'>>;
    crop?: ReturnType<typeof parseDims<'left' | 'top' | 'right' | 'bottom'>>;
}

export function parseImageOp(parameters: MIMETypeParameters | URLSearchParams): ImageOp {
    return {
        resize: parseDims({
            width: parameters.get('width'),
            height: parameters.get('height'),
        }),
        crop: parseDims({
            left: parameters.get('left'),
            top: parameters.get('top'),
            right: parameters.get('right'),
            bottom: parameters.get('bottom'),
        }),
    };
}

export function toImageOp(options: RecordingStreamThumbnailOptions) {
    const ret: ImageOp = {};
    const { resize, crop } = options || {};
    if (resize) {
        ret.resize = {
            width: resize.width,
            height: resize.height,
            fractional: resize.percent,
        };
    }
    if (crop) {
        ret.crop = {
            left: crop.left,
            top: crop.top,
            right: crop.left + crop.width,
            bottom: crop.top + crop.height,
            fractional: crop.percent,
        }
    }
    return ret;
}

export async function processImageOp(input: string | FFmpegInput | Buffer, op: ImageOp, time: number, sourceId: string, debugConsole: Console): Promise<Buffer> {
    const { crop, resize } = op;
    const { width, height, fractional } = resize || {};
    const { left, top, right, bottom, fractional: cropFractional } = crop || {};

    const filenameOrBuffer = typeof input === 'string' || Buffer.isBuffer(input) ? input : input.url?.startsWith('file:') && url.fileURLToPath(input.url);

    if (filenameOrBuffer && loadSharp()) {
        const vips = await loadVipsImage(filenameOrBuffer, sourceId);

        const resize = width != null && {
            width,
            height,
        };

        if (fractional) {
            if (resize.width)
                resize.width *= vips.width;
            if (resize.height)
                resize.height *= vips.height;
        }

        const crop = left != null && {
            left,
            top,
            width: right - left,
            height: bottom - top,
        };

        if (cropFractional) {
            crop.left *= vips.width;
            crop.top *= vips.height;
            crop.width *= vips.width;
            crop.height *= vips.height;
        }

        try {
            const ret = await vips.toBuffer({
                resize,
                crop,
                format: 'jpg',
            });
            return ret;
        }
        finally {
            vips.close();
        }
    }

    const ffmpegOpts: FFmpegImageFilterOptions = {
        console: debugConsole,
        ffmpegPath: await sdk.mediaManager.getFFmpegPath(),
        resize: width === undefined && height === undefined
            ? undefined
            : {
                width,
                height,
                fractional,
            },
        crop: left === undefined || right === undefined || top === undefined || bottom === undefined
            ? undefined
            : {
                left,
                top,
                width: right - left,
                height: bottom - top,
                fractional: cropFractional,
            },
        timeout: 10000,
        time,
    };

    if (Buffer.isBuffer(input)) {
        return ffmpegFilterImageBuffer(input, ffmpegOpts);
    }

    const ffmpegInput: FFmpegInput = typeof input !== 'string'
        ? input
        : {
            inputArguments: [
                '-i', input,
            ]
        };

    const args = [
        ...ffmpegInput.inputArguments,
        ...(ffmpegInput.h264EncoderArguments || []),
    ];

    return ffmpegFilterImage(args, ffmpegOpts);
}
