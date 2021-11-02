import * as jpeg from 'jpeg-js';
import { tensor3d, Tensor3D } from '@tensorflow/tfjs'

/**
 * Decode a JPEG-encoded image to a 3D Tensor of dtype `int32`.
 *
 * ```js
 * // Load an image as a Uint8Array
 * const imageUri = 'http://image-uri-here.example.com/image.jpg'; *
 * const response = await fetch(imageUri, {}, { isBinary: true });
 * const imageDataArrayBuffer = await response.arrayBuffer();
 * cosnt imageData = new Uint8Array(imageDataArrayBuffer);
 *
 * // Decode image data to a tensor
 * const imageTensor = decodeJpeg(imageData);
 * ```
 *
 * @param contents The JPEG-encoded image in an Uint8Array.
 * @param channels An optional int. Defaults to 3. Accepted values are
 *     0: use the number of channels in the JPG-encoded image.
 *     1: output a grayscale image.
 *     3: output an RGB image.
 * @returns A 3D Tensor of dtype `int32` with shape [height, width, 1/3].
 *
 * @doc {heading: 'Media', subheading: 'Images'}
 */
export function decodeJpeg(
    contents: Uint8Array, channels: 0 | 1 | 3 = 3): Tensor3D {
    const { width, height, data } = jpeg.decode(contents, {
        useTArray: true,
        formatAsRGBA: false,
    });

    return tensor3d(data, [height, width, channels]);
}

export async function encodeJpeg(imageTensor: Tensor3D) {
    const [height, width] = imageTensor.shape;
    const buffer = await imageTensor.data();
    const frameData = new Uint8Array(width * height * 4);

    let offset = 0;
    for (let i = 0; i < frameData.length; i += 4) {
        frameData[i] = buffer[offset];
        frameData[i + 1] = buffer[offset + 1];
        frameData[i + 2] = buffer[offset + 2];
        frameData[i + 3] = 0xFF;

        offset += 3;
    }

    const rawImageData = {
        data: frameData,
        width,
        height,
    };
    const jpegImageData = jpeg.encode(rawImageData);

    return jpegImageData.data;
}