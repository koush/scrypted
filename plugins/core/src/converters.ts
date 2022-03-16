import { BufferConverter, HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase, ScryptedMimeTypes } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import mime from "mime/lite";
import path from 'path';
import crypto from 'crypto';

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

        response.send(file.data as Buffer, {
            headers: {
                'Content-Type': file.fromMimeType,
            }
        });
    }

    async convert(buffer: string, fromMimeType: string, toMimeType: string): Promise<Buffer> {
        const uuid = uuidv4();

        const endpoint = await (this.secure ? endpointManager.getPublicLocalEndpoint(this.nativeId) : endpointManager.getInsecurePublicLocalEndpoint(this.nativeId));
        const extension = mime.getExtension(fromMimeType);

        const filename = uuid + (extension ? `.${extension}` : '');

        this.hosted.set(`/${filename}`, { data: buffer, fromMimeType, toMimeType });

        return Buffer.from(`${endpoint}${filename}`);
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

        response.sendFile(file.data as string);
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
