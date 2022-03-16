import { ScryptedDeviceBase, DeviceProvider, ScryptedInterface, ScryptedDeviceType, BufferConverter, MediaObject, VideoCamera, Camera, ScryptedMimeTypes, RequestMediaStreamOptions } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;
import { BufferHost, FileHost } from './converters';

export class MediaCore extends ScryptedDeviceBase implements DeviceProvider, BufferConverter {
    httpHost: BufferHost;
    httpsHost: BufferHost;
    fileHost: FileHost;
    filesHost: FileHost;

    constructor(nativeId: string) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.SchemePrefix + 'scrypted-media';
        this.toMimeType = ScryptedMimeTypes.MediaObject;

        (async () => {
            await deviceManager.onDevicesChanged({
                providerNativeId: this.nativeId,
                devices: [
                    {
                        name: 'HTTP Buffer Host',
                        nativeId: 'http',
                        interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                        type: ScryptedDeviceType.API,
                    },
                    {
                        providerNativeId: this.nativeId,
                        name: 'HTTPS Buffer Host',
                        nativeId: 'https',
                        interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                        type: ScryptedDeviceType.API,
                    },
                    {
                        name: 'HTTP File Host',
                        nativeId: 'file',
                        interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                        type: ScryptedDeviceType.API,
                    },
                    {
                        providerNativeId: this.nativeId,
                        name: 'HTTPS File Host',
                        nativeId: 'files',
                        interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                        type: ScryptedDeviceType.API,
                    },
                ]
            })
            this.httpHost = new BufferHost(false);
            this.httpsHost = new BufferHost(true);
            this.fileHost = new FileHost(false);
            this.filesHost = new FileHost(true);
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
        if (nativeId === 'file')
            return this.fileHost;
        if (nativeId === 'files')
            return this.filesHost;
    }
}