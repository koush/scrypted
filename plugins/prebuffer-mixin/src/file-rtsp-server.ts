import { Headers, RtspServer } from "@scrypted/common/src/rtsp-server";
import fs from 'fs';
import net from 'net';

// non standard extension that dumps the rtp payload to a file.
export class FileRtspServer extends RtspServer {
    writeStream: fs.WriteStream;
    segmentBytesWritten = 0;
    writeConsole: Console;

    constructor(client: net.Socket, sdp?: string, checkRequest?: (method: string, url: string, headers: Headers, rawMessage: string[]) => Promise<boolean>) {
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

    write(url: string, requestHeaders: Headers) {
        this.cleanup();
        this.segmentBytesWritten = 0;

        const file = requestHeaders['x-scrypted-rtsp-file'];

        if (!file)
            return this.respond(400, 'Bad Request', requestHeaders, {});

        // this.writeConsole?.log('RTSP WRITE file', file);
        this.writeStream = fs.createWriteStream(file);
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