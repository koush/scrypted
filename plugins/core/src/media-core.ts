import path from 'path';
import { ScryptedDeviceBase, DeviceProvider, ScryptedInterface, ScryptedDeviceType, BufferConverter, MediaObject, VideoCamera, Camera, ScryptedMimeTypes, RequestMediaStreamOptions, HttpRequestHandler, HttpRequest, HttpResponse } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;
import { BufferHost, FileHost } from './converters';

export class MediaCore extends ScryptedDeviceBase implements DeviceProvider, BufferConverter, HttpRequestHandler {
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

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.isPublicEndpoint) {
            response.send('', {
                code: 404,
            });
            return;
        }
        const pathname = request.url.substring(request.rootPath.length);
        const [_, id, iface] = pathname.split('/');
        try {
            if (iface !== ScryptedInterface.Camera)
                throw new Error();

            const search = new URLSearchParams(pathname.split('?')[1]);

            const picture = await systemManager.getDeviceById<Camera>(id).takePicture({
                picture: {
                    width: parseInt(search.get('width')) || undefined,
                    height: parseInt(search.get('height')) || undefined,
                }
            });
            const buffer = await mediaManager.convertMediaObjectToBuffer(picture, 'image/jpeg');

            response.send(buffer, {
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'max-age=10',
                }
            });
        }
        catch (e) {
            response.send('', {
                code: 500,
            });
        }
    }

    async getLocalSnapshot(id: string, iface: string, search: string) {
        const endpoint = await endpointManager.getAuthenticatedPath(this.nativeId);
        const url = path.join(endpoint, id, iface, `${Date.now()}.jpg`) + `${search}`;
        return mediaManager.createMediaObject(Buffer.from(url), ScryptedMimeTypes.LocalUrl);
    }

    async convert(data: string, fromMimeType: string, toMimeType: string): Promise<MediaObject> {
        const url = new URL(data.toString());
        const id = url.hostname;
        const path = url.pathname.split('/')[1];
        if (path === ScryptedInterface.Camera) {
            if (toMimeType === ScryptedMimeTypes.LocalUrl)
                return this.getLocalSnapshot(id, path, url.search);
            return await systemManager.getDeviceById<Camera>(id).takePicture() as any;
        }
        if (path === ScryptedInterface.VideoCamera) {
            return await systemManager.getDeviceById<VideoCamera>(id).getVideoStream() as any;
        }
        else {
            throw new Error('Unrecognized Scrypted Media interface.')
        }
    }

    async getDevice(nativeId: string) {
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