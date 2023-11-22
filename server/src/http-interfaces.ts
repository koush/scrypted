import { HttpResponse, HttpResponseOptions } from "@scrypted/types";
import { Response } from "express";
import fs from 'fs';
import net from 'net';
import { join as pathJoin } from 'path';
import { RpcPeer } from "./rpc";

const mime = require('mime/lite');
export class HttpResponseImpl implements HttpResponse {
    constructor(public res: Response, public unzippedDir: string, public filesPath: string) {
    }

    [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = [
        'send',
        'sendFile',
        'sendSocket',
    ];
    sent = false;

    #setHeaders(options?: HttpResponseOptions) {
        if (!options?.headers)
            return;
        for (const header of Object.keys(options.headers)) {
            const val = (options.headers as any)[header];
            // null-ish headers will cause something to fail downstream.
            if (val != null)
                this.res.setHeader(header, val);
        }
    }

    send(body: string): void;
    send(body: string, options: HttpResponseOptions): void;
    send(body: Buffer): void;
    send(body: Buffer, options: HttpResponseOptions): void;
    send(body: any, options?: any) {
        this.sent = true;
        if (options?.code)
            this.res.status(options.code);
        this.#setHeaders(options);

        this.res.send(body);
    }

    sendFile(path: string): void;
    sendFile(path: string, options: HttpResponseOptions): void;
    sendFile(path: any, options?: HttpResponseOptions) {
        this.sent = true;
        if (options?.code)
            this.res.status(options.code);
        this.#setHeaders(options);

        if (!this.res.getHeader('Content-Type')) {
            const type = mime.getType(path);
            if (type) {
                this.res.contentType(mime.getExtension(type));
            }
        }

        let filePath = pathJoin(this.unzippedDir, 'fs', path);
        if (!fs.existsSync(filePath)) {
            filePath = pathJoin(this.filesPath, path);
            if (!fs.existsSync(filePath)) {
                filePath = path;
                if (!fs.existsSync(filePath)) {
                    this.res.status(404);
                    this.res.end();
                    return;
                }
            }
        }

        // prefer etag
        this.res.sendFile(filePath, {
            cacheControl: false,
        });
    }

    sendSocket(socket: net.Socket, options: HttpResponseOptions) {
        this.sent = true;
        if (options?.code)
            this.res.status(options.code);
        this.#setHeaders(options);
        socket.pipe(this.res);
    }
}

export function createResponseInterface(res: Response, unzippedDir: string, filesPath: string): HttpResponseImpl {
    return new HttpResponseImpl(res, unzippedDir, filesPath);
}
