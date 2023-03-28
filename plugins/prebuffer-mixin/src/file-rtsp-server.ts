import { Deferred } from "@scrypted/common/src/deferred";
import { Headers, RtspServer } from "@scrypted/common/src/rtsp-server";
import fs from 'fs';
import { format } from "path";
import { Duplex } from "stream";

// non standard extension that dumps the rtp payload to a file.
export class FileRtspServer extends RtspServer {
    writeStream: fs.WriteStream;
    segmentBytesWritten = 0;
    writeConsole: Console;

    constructor(client: Duplex, sdp?: string, checkRequest?: (method: string, url: string, headers: Headers, rawMessage: string[]) => Promise<boolean>) {
        super(client, sdp, undefined, checkRequest);

        this.client.on('close', () => {
            if (this.writeStream)
                this.writeConsole?.log('RTSP WRITE client closed.');
            this.cleanup();
        });

        this.availableOptions.push('WRITE', "WRITESIZE");
    }

    cleanup() {
        const ws = this.writeStream;
        if (!ws)
            return;
        this.writeStream = undefined;
        ws?.end(() => ws?.destroy());
    }

    async write(url: string, requestHeaders: Headers) {
        const file = requestHeaders['x-scrypted-rtsp-file'];

        if (!file)
            return this.respond(400, 'Bad Request', requestHeaders, {});

        const truncate = requestHeaders['x-scrypted-rtsp-file-truncate'];

        // this.writeConsole?.log('RTSP WRITE file', file);

        // truncation preparation must happen before cleanup.
        let truncateWriteStream: fs.WriteStream;
        if (truncate) {
            try {
                const d = new Deferred<number>();
                fs.open(truncate, 'w', (e, fd) => {
                    if (e)
                        d.reject(e);
                    else
                        d.resolve(fd);
                });
                const fd = await d.promise;
                try {
                    await fs.promises.rename(truncate, file);
                    truncateWriteStream = fs.createWriteStream(undefined, {
                        fd,
                    })
                    // this.writeConsole?.log('truncating', truncate);
                }
                catch (e) {
                    throw e;
                }
            }
            catch (e) {
                this.writeConsole?.error('RTSP WRITE error during truncate file', truncate, e);
            }
        }

        // everything after this point must be sync due to cleanup potentially causing dangling state.
        this.cleanup();
        this.segmentBytesWritten = 0;

        this.writeStream = truncateWriteStream || fs.createWriteStream(file);
        this.writeStream.on('error', e => {
            this.writeConsole?.error('RTSP WRITE error', e);
        });
        this.respond(200, 'OK', requestHeaders, {});
    }

    writesize(url: string, requestHeaders: Headers) {
        this.respond(200, 'OK', requestHeaders, {
            'x-scrypted-rtsp-file-size': this.segmentBytesWritten.toString(),
        });
    }

    writeRtpPayload(header: Buffer, rtp: Buffer): boolean {
        if (!this.writeStream)
            return super.writeRtpPayload(header, rtp);

        this.segmentBytesWritten += header.length + rtp.length;
        this.writeStream.write(header);
        return this.writeStream.write(rtp);
    }
}