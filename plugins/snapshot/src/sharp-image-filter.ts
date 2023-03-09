import sharp, { FormatEnum, AvailableFormatInfo } from 'sharp';

export interface SharpImageFilterOptions {
    console?: Console,
    blur?: boolean;
    brightness?: number;
    // text?: {
    //     text: string;
    //     fontFile: string;
    // };

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

    format?: keyof FormatEnum | AvailableFormatInfo;
}


export async function sharpFilterImage(inputJpeg: Buffer | string, options: SharpImageFilterOptions) {
    let image = sharp(inputJpeg);
    const metadata = await image.metadata();
    if (options?.crop) {
        let { left, top, width, height, fractional } = options.crop;
        if (fractional) {
            left = Math.floor(left * metadata.width);
            width = Math.floor(width * metadata.width);
            top = Math.floor(top * metadata.height);
            height = Math.floor(height * metadata.height);
        }
        image = image.extract({
            left,
            top,
            width,
            height,
        });
    }

    if (options?.resize) {
        let { width, height, fractional } = options.resize;
        if (fractional) {
            if (width)
                width = Math.floor(width * metadata.width);
            if (height)
                height = Math.floor(height * metadata.height);
        }
        image = image.resize(width, height);
    }

    if (options?.brightness) {
        image = image.modulate({
            lightness: options.brightness  * 100,
        });
    }

    if (options?.blur) {
        image = image.blur(25);
    }

    // if (options?.text) {
    // }


    image = image.toFormat(options?.format || 'jpg');

    return image.toBuffer();
}
