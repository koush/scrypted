import { readLength, readLine } from './read-stream';
import { Duplex } from 'stream';
import { randomBytes } from 'crypto';
import { StreamChunk, StreamParser } from './stream-parser';

interface Headers {
    [header: string]: string
}

function findSyncFrame(streamChunks: StreamChunk[]): StreamChunk[] {
    return streamChunks;
}

export interface RtspStreamParser extends StreamParser {
    sdp: Promise<string>;
}

export function createRtspParser(): RtspStreamParser {
    let resolve: any;

    return {
        container: 'rtsp',
        tcpProtocol: 'rtsp://127.0.0.1/' + randomBytes(8).toString('hex'),
        inputArguments: [
            '-rtsp_transport',
            'tcp',
        ],
        outputArguments: [
            '-rtsp_transport',
            'tcp',
            '-vcodec', 'copy',
            '-acodec', 'copy',
            '-f', 'rtsp',
        ],
        findSyncFrame,
        sdp: new Promise<string>(r => resolve = r),
        async *parse(duplex, width, height) {
            const server = new RtspServer(duplex);
            await server.handleSetup();
            resolve(server.sdp);
            for await (const { type, rtcp, header, packet } of server.handleRecord()) {
                yield {
                    chunks: [header, packet],
                    type,
                    width,
                    height,
                }
            }
        }
    }
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
    videoChannel = 0;
    audioChannel = 2;
    session: string;

    constructor(public duplex: Duplex, public sdp?: string) {
        this.session = randomBytes(4).toString('hex');
    }

    async handleSetup() {
        let currentHeaders: string[] = [];
        while (true) {
            let line = await readLine(this.duplex);
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

    async handlePlayback() {
        return this.handleSetup();
    }

    async *handleRecord(): AsyncGenerator<{
        type: 'audio' | 'video',
        rtcp: boolean,
        header: Buffer,
        packet: Buffer,
    }> {
        while (true) {
            const header = await readLength(this.duplex, 4);
            const length = header.readUInt16BE(2);
            const packet = await readLength(this.duplex, length);
            const id = header.readUInt8(1);
            yield {
                type: id - (id % 2) === this.videoChannel ? 'video' : 'audio',
                rtcp: id % 2 === 1,
                header,
                packet,
            }
        }
    }

    send(rtp: Buffer, channel: number) {
        const header = Buffer.alloc(4);
        header.writeUInt8(36, 0);
        header.writeUInt8(channel, 1);
        header.writeUInt16BE(rtp.length, 2);

        this.duplex.write(header);
        this.duplex.write(Buffer.from(rtp));
    }

    sendVideo(packet: Buffer, rtcp: boolean) {
        this.send(packet, rtcp ? this.videoChannel + 1 : this.videoChannel);
    }

    sendAudio(packet: Buffer, rtcp: boolean) {
        this.send(packet, rtcp ? this.audioChannel + 1 : this.audioChannel);
    }

    options(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
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
    }

    async announce(url: string, requestHeaders: Headers) {
        const contentLength = parseInt(requestHeaders['content-length']);
        const sdpBuffer = await readLength(this.duplex, contentLength);
        this.sdp = sdpBuffer.toString();
        const headers: Headers = {};
        headers['Session'] = this.session;

        this.respond(200, 'OK', requestHeaders, headers);
    }

    async record(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['Session'] = this.session;
        this.respond(200, 'OK', requestHeaders, headers);
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
        return method !== 'play' && method !== 'record';
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
        this.duplex.write(response);
        if (buffer)
            this.duplex.write(buffer);
    }
}
