import sdk, { BufferConverter, HttpRequest, HttpRequestHandler, HttpResponse, HttpResponseOptions, MediaObject, RequestMediaObject, ScryptedDeviceBase, ScryptedMimeTypes } from "@scrypted/sdk";
import crypto from 'crypto';
import path from 'path';

const { endpointManager } = sdk;

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export class BufferHost extends ScryptedDeviceBase implements HttpRequestHandler, BufferConverter {
    hosted = new Map<string, { data: Buffer | string, fromMimeType: string, toMimeType: string }>()

    constructor(public secure: boolean) {
        super(secure ? 'https' : 'http');
        this.fromMimeType = '*/*';
        this.secure = secure;
        this.toMimeType = secure ? ScryptedMimeTypes.LocalUrl : ScryptedMimeTypes.InsecureLocalUrl;
    }

    async onRequest(request: HttpRequest, response: HttpResponse) {
        const normalizedRequest = Object.assign({}, request);
        normalizedRequest.url = normalizedRequest.url.replace(normalizedRequest.rootPath, '');
        const pathOnly = normalizedRequest.url.split('?')[0];
        const file = this.hosted.get(pathOnly);

        if (!file) {
            response.send('Not Found', {
                code: 404,
            });
            return;
        }


        let options: HttpResponseOptions = {
            headers: {
                'Content-Type': file.fromMimeType,
            }
        };

        const q = new URLSearchParams(request.url.split('?')[1]);
        if (q.has('attachment')) {
            options.headers['Content-Disposition'] = 'attachment';
        }

        response.send(file.data as Buffer,);
    }

    async convert(buffer: string, fromMimeType: string, toMimeType: string): Promise<Buffer> {
        const uuid = uuidv4();

        const { default: mime } = await import('mime');

        const endpoint = await (this.secure ? endpointManager.getPublicLocalEndpoint(this.nativeId) : endpointManager.getInsecurePublicLocalEndpoint(this.nativeId));
        const extension = mime.getExtension(fromMimeType);

        const filename = uuid + (extension ? `.${extension}` : '');

        this.hosted.set(`/${filename}`, { data: buffer, fromMimeType, toMimeType });
        setTimeout(() => this.hosted.delete(`/${filename}`), 10 * 60 * 1000); // free this resource after 10 min.

        return Buffer.from(`${endpoint}${filename}`);
    }
}

export class RequestMediaObjectHost extends ScryptedDeviceBase implements HttpRequestHandler, BufferConverter {
    secureHosted = new Map<string, { request: RequestMediaObject, fromMimeType: string, toMimeType: string }>()
    insecureHosted = new Map<string, { request: RequestMediaObject, fromMimeType: string, toMimeType: string }>()

    constructor() {
        super('rmo-host');
        this.fromMimeType = ScryptedMimeTypes.RequestMediaObject;
        this.toMimeType = ScryptedMimeTypes.MediaObject;
        // this.toMimeType = secure ? ScryptedMimeTypes.LocalUrl : ScryptedMimeTypes.InsecureLocalUrl;
    }

    async onRequest(request: HttpRequest, response: HttpResponse) {
        const normalizedRequest = Object.assign({}, request);
        normalizedRequest.url = normalizedRequest.url.replace(normalizedRequest.rootPath, '');
        const pathOnly = normalizedRequest.url.split('?')[0];
        const file = this.secureHosted.get(pathOnly) || this.insecureHosted.get(pathOnly);;

        if (!file) {
            response.send('Not Found', {
                code: 404,
            });
            return;
        }


        let options: HttpResponseOptions = {
            headers: {
                'Content-Type': file.fromMimeType,
            }
        };

        const q = new URLSearchParams(request.url.split('?')[1]);
        if (q.has('attachment')) {
            options.headers['Content-Disposition'] = 'attachment';
        }

        try {
            const mo = await file.request();
            const data = await sdk.mediaManager.convertMediaObjectToBuffer(mo, mo.mimeType);

            response.send(data);
        }
        catch (e) {
            this.secureHosted.delete(pathOnly);
            this.insecureHosted.delete(pathOnly);
            throw e;
        }
    }

    async convert(request: RequestMediaObject, fromMimeType: string, toMimeType: string): Promise<MediaObject> {
        let hosted: typeof this.secureHosted;
        if (toMimeType === ScryptedMimeTypes.Url || toMimeType === ScryptedMimeTypes.LocalUrl) {
            hosted = this.secureHosted;
            toMimeType = ScryptedMimeTypes.LocalUrl;
        }
        else if (toMimeType === ScryptedMimeTypes.InsecureLocalUrl) {
            hosted = this.insecureHosted;
        }
        else {
            return request();
        }

        const uuid = uuidv4();

        const endpoint = await (toMimeType === ScryptedMimeTypes.LocalUrl ? endpointManager.getPublicLocalEndpoint(this.nativeId) : endpointManager.getInsecurePublicLocalEndpoint(this.nativeId));
        const data = await request();
        fromMimeType = data.mimeType;
        const { default: mime } = await import('mime');
        const extension = mime.getExtension(fromMimeType);

        const filename = uuid + (extension ? `.${extension}` : '');

        const pathOnly = `/${filename}`;
        hosted.set(pathOnly, { request, fromMimeType, toMimeType });
        // free this resource after an hour.
        setTimeout(() => hosted.delete(pathOnly), 1 * 60 * 60 * 1000);

        const url = Buffer.from(`${endpoint}${filename}`);
        return sdk.mediaManager.createMediaObject(url, toMimeType);
    }
}

export class FileHost extends ScryptedDeviceBase implements HttpRequestHandler, BufferConverter {
    hosted = new Map<string, { data: Buffer | string }>()

    constructor(public secure: boolean) {
        super(secure ? 'files' : 'file');
        this.fromMimeType = ScryptedMimeTypes.SchemePrefix + 'file';
        this.secure = secure;
        this.toMimeType = secure ? ScryptedMimeTypes.LocalUrl : ScryptedMimeTypes.InsecureLocalUrl;
    }

    async onRequest(request: HttpRequest, response: HttpResponse) {
        const normalizedRequest = Object.assign({}, request);
        normalizedRequest.url = normalizedRequest.url.replace(normalizedRequest.rootPath, '');
        const pathOnly = normalizedRequest.url.split('?')[0];
        const file = this.hosted.get(pathOnly);

        let options: HttpResponseOptions;
        const q = new URLSearchParams(request.url.split('?')[1]);
        if (q.has('attachment')) {
            options = {
                headers: {
                    'Content-Disposition': 'attachment',
                },
            };
        }
        response.sendFile(file.data as string, options);
    }

    async convert(buffer: string, fromMimeType: string, toMimeType: string): Promise<Buffer> {
        const { pathname } = new URL(buffer);
        // one way hash that is browser cache friendly
        const uuid = crypto.createHash('sha256').update(pathname).digest('hex');

        const endpoint = await (this.secure ? endpointManager.getPublicLocalEndpoint(this.nativeId) : endpointManager.getInsecurePublicLocalEndpoint(this.nativeId));
        const extension = path.extname(pathname).substring(1);

        const filename = uuid + (extension ? `.${extension}` : '');

        this.hosted.set(`/${filename}`, { data: pathname });

        return Buffer.from(`${endpoint}${filename}`);
    }
}
