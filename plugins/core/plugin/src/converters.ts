import { BufferConverter, HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase, ScryptedMimeTypes } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import mimeTypes from "mime-types";

const {endpointManager} = sdk;

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export class UrlConverter extends ScryptedDeviceBase implements HttpRequestHandler, BufferConverter {
    hosted = new Map<string, {buffer: Buffer, fromMimeType: string }>()
    secure: boolean;

    constructor(secure: boolean) {
        super(secure ? 'https': 'http');
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

        response.send(file.buffer, {
            headers: {
                'Content-Type': file.fromMimeType,
            }
        });
    }

    getEndpoint(): string {
        throw new Error("Method not implemented.");
    }

    async convert(buffer: Buffer, fromMimeType: string): Promise<Buffer|string> {
        const uuid = uuidv4();

        const endpoint = await (this.secure ? endpointManager.getPublicLocalEndpoint(this.nativeId) : endpointManager.getInsecurePublicLocalEndpoint(this.nativeId));
        const extension = mimeTypes.extension(fromMimeType);

        const filename = uuid + (extension ? `.${extension}` : '');

        this.hosted.set(`/${filename}`, { buffer, fromMimeType });

        return `${endpoint}${filename}`;
    }
}
