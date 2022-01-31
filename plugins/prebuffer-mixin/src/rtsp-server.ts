import { readLine } from '../../../common/src/read-length';
import net from 'net';
import { Duplex, Readable } from 'stream';
import { randomBytes } from 'crypto';


interface Headers{ 
    [header: string]: string 
}

function parseHeaders(headers: string[]): Headers {
    const ret = {};
    for (const header of headers.slice(1)) {
        const index = header.indexOf(':');
        let value = '';
        if (index !== -1)
            value = header.substring(index + 1).trim();
        const key = header.substring(0, index).toLowerCase();
        ret[key] = value;
    }
    return ret;
}

export class RtspServer {
    session: string;
    constructor(public socket: Duplex, public sdp: string, public playing: (server: RtspServer) => void) {
        this.session = randomBytes(4).toString('hex');
        this.loop();
    }

    async loop() {
        try {
            let currentHeaders: string[] = [];
            while (true) {
                let line = await readLine(this.socket);
                line = line.trim();
                if (!line) {
                    if (!await this.headers(currentHeaders))
                        break;
                    currentHeaders = [];
                    continue;
                }
                currentHeaders.push(line);
            }
        }
        catch (e) {
        }
    }

    send(rtp: Buffer, channel: number) {
        const header = Buffer.alloc(4);
        header.writeUInt8(36, 0);
        header.writeUInt8(channel, 1);
        header.writeUInt16BE(rtp.length, 2);

        this.socket.write(header);
        this.socket.write(Buffer.from(rtp));
    }

    sendVideo(packet: Buffer, rtcp: boolean) {
        this.send(packet, rtcp ? 1 : 0);
    }

    sendAudio(packet: Buffer, rtcp: boolean) {
        this.send(packet, rtcp ? 3 : 2);
    }

    options(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['CSeq'] = requestHeaders['cseq'];
        headers['Public'] = 'DESCRIBE, OPTIONS, PAUSE, PLAY, SETUP, TEARDOWN, ANNOUNCE, RECORD';

        this.respond(200, 'OK', requestHeaders, headers);
    }

    describe(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['Content-Base'] = url;
        headers['Content-Type'] = 'application/sdp';
        this.respond(200, 'OK', requestHeaders, headers, Buffer.from(this.sdp))
    }

    setup(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['Transport'] = requestHeaders['transport'];
        headers['Session'] = this.session;
        this.respond(200, 'OK', requestHeaders, headers)
    }

    play(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['RTP-Info'] = `url=${url}/trackID=0;seq=0;rtptime=0,url=${url}/trackID=1;seq=0;rtptime=0`;
        headers['Range'] = 'npt=now-';
        headers['Session'] = this.session;
        this.respond(200, 'OK', requestHeaders, headers);

        this.playing(this);
    }

    async headers(headers: string[]) {
        let [method, url] = headers[0].split(' ', 2);
        method = method.toLowerCase();
        const requestHeaders = parseHeaders(headers);
        if (!this[method]) {
            this.respond(400, 'Bad Request', requestHeaders, {});
            return;
        }

        await this[method](url, requestHeaders);
        return method !== 'play';
    }

    respond(code: number, message: string, requestHeaders: Headers, headers: Headers, buffer?: Buffer) {
        let response = `RTSP/1.0 ${code} ${message}\r\n`;
        if (requestHeaders['cseq'])
            headers['CSeq'] = requestHeaders['cseq'];
        if (buffer)
            headers['Content-Length'] = buffer.length.toString();
        for (const [key, value] of Object.entries(headers)) {
            response += `${key}: ${value}\r\n`;
        }
        response += '\r\n';
        this.socket.write(response);
        if (buffer)
            this.socket.write(buffer);
    }
}
