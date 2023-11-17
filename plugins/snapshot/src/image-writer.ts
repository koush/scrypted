import { BufferConverter, Image, MediaObjectOptions, ScryptedDeviceBase, ScryptedMimeTypes, ScryptedNativeId } from "@scrypted/sdk";

export const ImageWriterNativeId = 'imagewriter';
export class ImageWriter extends ScryptedDeviceBase implements BufferConverter {
    constructor(nativeId: ScryptedNativeId) {
        super(nativeId)

        this.fromMimeType = ScryptedMimeTypes.Image;
        this.toMimeType = 'image/*';
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const image = data as Image;
        return image.toBuffer({
            format: 'jpg',
        });
    }
}
