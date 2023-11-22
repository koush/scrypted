import sdk, { FFmpegInput } from '@scrypted/sdk';
import type { MIMETypeParameters } from 'whatwg-mimetype';
import { loadSharp, loadVipsImage } from './image-reader';
import { ffmpegFilterImage } from './ffmpeg-image-filter';

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

export async function processImageOp(input: string | FFmpegInput, op: ImageOp, time: number, sourceId: string, debugConsole: Console): Promise<Buffer> {
    const { crop, resize } = op;
    const { width, height, fractional } = resize;
    const { left, top, right, bottom, fractional: cropFractional } = crop;

    const filename = typeof input === 'string' ? input : input.url?.startsWith('file:') && new URL(input.url).pathname;

    if (filename && loadSharp()) {
        const vips = await loadVipsImage(filename, sourceId);

        const resize = width && {
            width,
            height,
        };

        if (fractional) {
            if (resize.width)
                resize.width *= vips.width;
            if (resize.height)
                resize.height *= vips.height;
        }

        const crop = left && {
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

    return ffmpegFilterImage(args, {
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
    });
}
