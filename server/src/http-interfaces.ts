import { HttpResponse, HttpResponseOptions } from "@scrypted/types";
import { Response } from "express";
import fs from 'fs';
import net from 'net';
import { join as pathJoin } from 'path';
import { RpcPeer } from "./rpc";

const mime = require('mime/lite');

export function createResponseInterface(res: Response, unzippedDir: string, filesPath: string): HttpResponse {
    class HttpResponseImpl implements HttpResponse {
        [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS] = [
            'send',
            'sendFile',
            'sendSocket',
        ];

        #setHeaders(options?: HttpResponseOptions) {
            if (!options?.headers)
                return;
            for (const header of Object.keys(options.headers)) {
                const val = (options.headers as any)[header];
                // null-ish headers will cause something to fail downstream.
                if (val != null)
                    res.setHeader(header, val);
            }
        }

        send(body: string): void;
        send(body: string, options: HttpResponseOptions): void;
        send(body: Buffer): void;
        send(body: Buffer, options: HttpResponseOptions): void;
        send(body: any, options?: any) {
            if (options?.code)
                res.status(options.code);
            this.#setHeaders(options);

            res.send(body);
        }

        sendFile(path: string): void;
        sendFile(path: string, options: HttpResponseOptions): void;
        sendFile(path: any, options?: HttpResponseOptions) {
            if (options?.code)
                res.status(options.code);
            this.#setHeaders(options);

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
                    filePath = path;
                    if (!fs.existsSync(filePath)) {
                        res.status(404);
                        res.end();
                        return;
                    }
                }
            }

            // prefer etag
            res.sendFile(filePath, {
                cacheControl: false,
            });
        }

        sendSocket(socket: net.Socket, options: HttpResponseOptions) {
            if (options?.code)
                res.status(options.code);
            this.#setHeaders(options);
            socket.pipe(res);
        }
    }

    return new HttpResponseImpl();
}
