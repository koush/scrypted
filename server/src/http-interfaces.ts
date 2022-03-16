import { HttpResponse, HttpResponseOptions } from "@scrypted/types";
import { Response } from "express";
import { RpcPeer } from "./rpc";
import { join as pathJoin } from 'path';
import fs from 'fs';

const mime = require('mime/lite');

export function createResponseInterface(res: Response, unzippedDir: string, filesPath: string): HttpResponse {
    class HttpResponseImpl implements HttpResponse {
        [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = [
            'send',
            'sendFile',
        ];

        send(body: string): void;
        send(body: string, options: HttpResponseOptions): void;
        send(body: Buffer): void;
        send(body: Buffer, options: HttpResponseOptions): void;
        send(body: any, options?: any) {
            if (options?.code)
                res.status(options.code);
            if (options?.headers) {
                for (const header of Object.keys(options.headers)) {
                    res.setHeader(header, (options.headers as any)[header]);
                }
            }

            res.send(body);
        }

        sendFile(path: string): void;
        sendFile(path: string, options: HttpResponseOptions): void;
        sendFile(path: any, options?: HttpResponseOptions) {
            if (options?.code)
                res.status(options.code);
            if (options?.headers) {
                for (const header of Object.keys(options.headers)) {
                    res.setHeader(header, (options.headers as any)[header]);
                }
            }

            if (!res.getHeader('Content-Type')) {
                const type = mime.getType(path);
                if (type) {
                    res.contentType(mime.getExtension(type));
                }
            }

            let filePath = pathJoin(unzippedDir, 'fs', path);
            if (!fs.existsSync(filePath)) {
                filePath = pathJoin(filesPath, path);
                if (!fs.existsSync(filePath)) {
                    res.status(404);
                    res.end();
                    return;
                }
            }
            res.sendFile(filePath);
        }
    }

    return new HttpResponseImpl();
}
