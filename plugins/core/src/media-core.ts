import { ScryptedDeviceBase, DeviceProvider, ScryptedInterface, ScryptedDeviceType, BufferConverter, MediaObject, VideoCamera, Camera, ScryptedMimeTypes, RequestMediaStreamOptions } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;
import { UrlConverter } from './converters';

export class MediaCore extends ScryptedDeviceBase implements DeviceProvider, BufferConverter {
    httpHost: UrlConverter;
    httpsHost: UrlConverter;

    constructor(nativeId: string) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.SchemePrefix + 'scrypted-media';
        this.toMimeType = ScryptedMimeTypes.MediaObject;

        (async () => {
            await deviceManager.onDevicesChanged({
                providerNativeId: this.nativeId,
                devices: [
                    {
                        name: 'HTTP file host',
                        nativeId: 'http',
                        interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                        type: ScryptedDeviceType.API,
                    },
                    {
                        providerNativeId: this.nativeId,
                        name: 'HTTPS file host',
                        nativeId: 'https',
                        interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                        type: ScryptedDeviceType.API,
                    }
                ]
            })
            this.httpHost = new UrlConverter(false);
            this.httpsHost = new UrlConverter(true);
        })();
    }

    async convert(data: string, fromMimeType: string, toMimeType: string): Promise<MediaObject> {
        const url = new URL(data.toString());
        const id = url.hostname;
        const path = url.pathname.split('/')[1];
        if (path === ScryptedInterface.Camera) {
            return await systemManager.getDeviceById<Camera>(id).takePicture() as any;
        }
        else {
            throw new Error('Unrecognized Scrypted Media interface.')
        }
    }

    getDevice(nativeId: string) {
        if (nativeId === 'http')
            return this.httpHost;
        if (nativeId === 'https')
            return this.httpsHost;
    }
}