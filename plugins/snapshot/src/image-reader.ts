import sdk, { BufferConverter, Image, ImageOptions, MediaObject, MediaObjectOptions, ScryptedDeviceBase, ScryptedMimeTypes } from "@scrypted/sdk";
import sharp from 'sharp';

async function createVipsMediaObject(image: VipsImage): Promise<Image & MediaObject> {
    const ret = await sdk.mediaManager.createMediaObject(image, ScryptedMimeTypes.Image, {
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

class VipsImage implements Image {
    constructor(public image: sharp.Sharp, public metadata: sharp.Metadata) {
    }

    get width() {
        return this.metadata.width;
    }
    get height() {
        return this.metadata.height;
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
        const newVipsImage = new VipsImage(newImage, newMetadata);
        return newVipsImage;
    }

    async toImage(options: ImageOptions) {
        if (options.format)
            throw new Error('format can only be used with toBuffer');
        const newVipsImage = await this.toVipsImage(options);
        return createVipsMediaObject(newVipsImage);
    }
}

export class ImageWriter extends ScryptedDeviceBase implements BufferConverter {
    constructor(nativeId: string) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.Image;
        this.toMimeType = 'image/*';
    }

    async convert(data: Image, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<Buffer> {
        return data.toBuffer({
            format: 'jpg',
        });
    }
}

export class ImageReader extends ScryptedDeviceBase implements BufferConverter {
    constructor(nativeId: string) {
        super(nativeId);

        this.fromMimeType = 'image/*';
        this.toMimeType = ScryptedMimeTypes.Image;
    }

    async convert(data: Buffer, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<Image> {
        const image = sharp(data, {
            failOnError: false,
        });
        const metadata = await image.metadata();
        const vipsImage = new VipsImage(image, metadata);
        return createVipsMediaObject(vipsImage);
    }
}
