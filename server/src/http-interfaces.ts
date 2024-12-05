import { HttpResponse, HttpResponseOptions } from "@scrypted/types";
import { Response } from "express";
import fs from 'fs';
import net from 'net';
import { join as pathJoin } from 'path';
import { RpcPeer } from "./rpc";

export class HttpResponseImpl implements HttpResponse {
    constructor(public res: Response, public unzippedDir: string, public filesPath: string) {
        res.on('error', e => {
            console.warn("Error while sending response from plugin", e);
        });
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

    send(body: string|Buffer, options?: any) {
        this.sent = true;
        if (options?.code)
            this.res.status(options.code);
        this.#setHeaders(options);

        this.res.send(body);
    }

    sendFile(path: string, options?: HttpResponseOptions) {
        this.sent = true;
        if (options?.code)
            this.res.status(options.code);
        this.#setHeaders(options);

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

    sendStream(stream: AsyncGenerator<Buffer, void>, options?: HttpResponseOptions): void {
        this.sent = true;
        if (options?.code)
            this.res.status(options.code);
        this.#setHeaders(options);
        (async() => {
            try {
                for await (const chunk of stream) {
                    this.res.write(chunk);
                }
                this.res.end();
            }
            catch (e) {
                this.res.destroy(e);
            }
        })();
    }
}

export function createResponseInterface(res: Response, unzippedDir: string, filesPath: string): HttpResponseImpl {
    return new HttpResponseImpl(res, unzippedDir, filesPath);
}
