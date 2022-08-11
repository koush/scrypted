import { RtspServer, Headers } from "@scrypted/common/src/rtsp-server";
import net from 'net';
import fs from 'fs';

// non standard extension that dumps the rtp payload to a file.
export class FileRtspServer extends RtspServer {
    writeStream: fs.WriteStream;
    segmentBytesWritten = 0;

    constructor(client: net.Socket, sdp?: string) {
        super(client, sdp);

        this.client.on('close', () => {
            this.cleanup();
        });

        this.availableOptions.push('WRITE', "WRITESIZE");
    }

    cleanup() {
        const ws = this.writeStream;
        this.writeStream = undefined;
        ws?.end(() => ws?.destroy());
    }

    write(url: string, requestHeaders: Headers) {
        this.cleanup();
        this.segmentBytesWritten = 0;

        const file = requestHeaders['x-scrypted-rtsp-file'];

        if (!file)
            return this.respond(400, 'Bad Request', requestHeaders, {});

        this.writeStream = fs.createWriteStream(file);

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