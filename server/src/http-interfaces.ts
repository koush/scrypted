import { HttpResponse, HttpResponseOptions } from "@scrypted/sdk/types";
import { Response } from "express";
import { PluginHost } from './plugin/plugin-host';
import mime from "mime";

export function createResponseInterface(res: Response, plugin: PluginHost): HttpResponse {
    class HttpResponseImpl implements HttpResponse {
        send(body: string): void;
        send(body: string, options: HttpResponseOptions): void;
        send(body: Buffer): void;
        send(body: Buffer, options: HttpResponseOptions): void;
        send(body: any, options?: any) {
            if (options.code)
                res.status(options.code);
            if (options.headers) {
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

            if (!res.getHeader('Content-Type'))
                res.contentType(mime.lookup(path));

            const data = plugin.zip.getEntry(`fs/${path}`)?.getData();
            if (!data) {
                res.status(404);
                res.end();
                return;
            }
            res.send(data);
        }
    }

    return new HttpResponseImpl();
}
