import sdk, { BufferConverter, Image, ImageOptions, MediaObject, MediaObjectOptions, ScryptedDeviceBase, ScryptedMimeTypes } from "@scrypted/sdk";
import sharp, { Sharp } from 'sharp';


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

        const ret: Image = await sdk.mediaManager.createMediaObject(image, ScryptedMimeTypes.Image, {
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            toBuffer: (options: ImageOptions) => {
                let transformed = image;
                if (options?.crop) {
                    transformed = transformed.extract({
                        ...options.crop,
                    });
                }
                if (options?.resize)
                    transformed = transformed.resize(options.resize.width, options.resize.height);
                return transformed.toBuffer();
            },
        })
        return ret;
    }
}
