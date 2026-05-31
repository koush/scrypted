import sdk, { BufferConverter, Image, ImageOptions, MediaObject, MediaObjectOptions, ScryptedDeviceBase, ScryptedMimeTypes } from "@scrypted/sdk";
import type sharp from 'sharp';
import type { KernelEnum } from "sharp";

let hasLoadedSharp = false;
let sharpInstance: typeof sharp;
export function loadSharp() {
    if (!hasLoadedSharp) {
        hasLoadedSharp = true;
        try {
            sharpInstance = require('sharp');
            console.log('sharp loaded');
        }
        catch (e) {
            console.warn('sharp failed to load, scrypted server may be out of date', e);
        }
    }
    return !!sharpInstance;
}

export const ImageReaderNativeId = 'imagereader';

export async function createVipsMediaObject(image: VipsImage): Promise<Image & MediaObject> {
    const ret: Image & MediaObject = await sdk.mediaManager.createMediaObject(image, ScryptedMimeTypes.Image, {
        sourceId: image.sourceId,
        width: image.width,
        height: image.height,
        format: null,
        toBuffer: (options: ImageOptions) => image.toBuffer(options),
        toImage: async (options: ImageOptions) => {
            const newImage = await image.toVipsImage(options);
            return createVipsMediaObject(newImage);
        },
        close: () => image.close(),
    });

    return ret;
}

export class VipsImage implements Image {
    constructor(public image: sharp.Sharp, public metadata: sharp.Metadata, public sourceId: string) {
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
            let kernel: keyof KernelEnum;
            switch (options?.resize.filter) {
                case 'lanczos':
                    kernel = 'lanczos2';
                    break;
                case 'mitchell':
                    kernel = 'mitchell';
                    break;
                case 'nearest':
                    kernel = 'nearest';
                    break;
                default:
                    kernel = 'cubic';
                    break
            }
            transformed.resize(typeof options.resize.width === 'number' ? Math.floor(options.resize.width) : undefined, typeof options.resize.height === 'number' ? Math.floor(options.resize.height) : undefined, {
                // haven't decided if these are the correct defaults.
                fit: options.resize.width && options.resize.height ? 'fill' : 'cover',
                kernel: kernel,
            });
        }

        return transformed;
    }

    async toBuffer(options: ImageOptions) {
        const transformed = this.toImageInternal(options);
        if (options?.format === 'rgb') {
            transformed.removeAlpha().toFormat('raw');
        }
        else if (options?.format === 'rgba') {
            transformed.ensureAlpha().toFormat('raw');
        }
        else if (options?.format === 'gray') {
            transformed.toFormat('raw').grayscale();
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

        const newImage = sharpInstance(data, {
            raw: info,
        });

        const newMetadata = await newImage.metadata();
        const newVipsImage = new VipsImage(newImage, newMetadata, this.sourceId);
        return newVipsImage;
    }

    async toImage(options: ImageOptions) {
        if (options?.format)
            throw new Error('format can only be used with toBuffer');
        const newVipsImage = await this.toVipsImage(options);
        return createVipsMediaObject(newVipsImage);
    }

    async close() {
        this.image?.destroy();
        this.image = undefined;
    }
}

export async function loadVipsMetadata(data: Buffer | string) {
    const image = sharpInstance(data, {
        failOn: 'none'
    });
    const metadata = await image.metadata();
    return {
        image,
        metadata,
    }
}

export async function loadVipsImage(data: Buffer | string, sourceId: string) {
    loadSharp();

    const { image, metadata } = await loadVipsMetadata(data);
    const vipsImage = new VipsImage(image, metadata, sourceId);
    return vipsImage;
}

export class ImageReader extends ScryptedDeviceBase implements BufferConverter {
    constructor(nativeId: string) {
        super(nativeId);

        this.fromMimeType = 'image/*';
        this.toMimeType = ScryptedMimeTypes.Image;
    }

    async convert(data: Buffer, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<Image> {
        const vipsImage = await loadVipsImage(data, options?.sourceId);
        return createVipsMediaObject(vipsImage);
    }
}
