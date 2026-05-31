import { BufferConverter, FFmpegInput, MediaObjectOptions, ScryptedDeviceBase, ScryptedMimeTypes, ScryptedNativeId } from '@scrypted/sdk';
import MIMEType from 'whatwg-mimetype';
import type { SnapshotPlugin } from './main';
import { parseImageOp, processImageOp } from './parse-dims';

export const ImageConverterNativeId = 'imageconverter';

export class ImageConverter extends ScryptedDeviceBase implements BufferConverter {
    constructor(public plugin: SnapshotPlugin, nativeId: ScryptedNativeId) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.FFmpegInput;
        this.toMimeType = 'image/jpeg';
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const mime = new MIMEType(toMimeType);

        const op = parseImageOp(mime.parameters);
        const ffmpegInput = JSON.parse(data.toString()) as FFmpegInput;

        return processImageOp(ffmpegInput, op, parseFloat(mime.parameters.get('time')), options?.sourceId, !!this.plugin.debugConsole);
    }
}
