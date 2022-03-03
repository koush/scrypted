import { readLength, readLine } from './read-stream';
import { Duplex, Readable } from 'stream';
import { randomBytes } from 'crypto';
import { StreamChunk, StreamParser } from './stream-parser';
import dgram from 'dgram';
import net from 'net';
import tls from 'tls';
import { DIGEST } from 'http-auth-utils/src/index';
import crypto from 'crypto';

export const RTSP_FRAME_MAGIC = 36;

interface Headers {
    [header: string]: string
}

function findSyncFrame(streamChunks: StreamChunk[]): StreamChunk[] {
    return streamChunks;
}

export interface RtspStreamParser extends StreamParser {
    sdp: Promise<string>;
}

export async function readMessage(client: Readable): Promise<string[]> {
    let currentHeaders: string[] = [];
    while (true) {
        let line = await readLine(client);
        line = line.trim();
        if (!line)
            return currentHeaders;
        currentHeaders.push(line);
    }
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

export function parseHeaders(headers: string[]): Headers {
    const ret: any = {};
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

export class RtspBase {
    client: net.Socket;

    write(line: string, headers: Headers, body?: Buffer) {
        let response = `${line}\r\n`;
        if (body)
            headers['Content-Length'] = body.length.toString();
        for (const [key, value] of Object.entries(headers)) {
            response += `${key}: ${value}\r\n`;
        }
        response += '\r\n';
        this.client.write(response);
        if (body)
            this.client.write(body);
    }

    async readMessage(): Promise<string[]> {
        return readMessage(this.client);
    }
}

const quote = (str: string): string => `"${str.replace(/"/g, '\\"')}"`;

// probably only works with scrypted rtsp server.
export class RtspClient extends RtspBase {
    cseq = 0;
    session: string;
    authorization: string;

    constructor(public url: string) {
        super();
        const u = new URL(url);
        const port = parseInt(u.port) || 554;
        if (url.startsWith('rtsps')) {
            this.client = tls.connect({
                rejectUnauthorized: false,
                port,
                host: u.hostname,
            })
        }
        else {
            this.client = net.connect(port, u.hostname);
        }
    }

    writeRequest(method: string, headers?: Headers, path?: string, body?: Buffer, authenticating?: boolean) {
        headers = headers || {};

        let fullUrl: string;
        if (path)
            fullUrl = new URL(path, this.url).toString();
        else
            fullUrl = this.url;

        const sanitized = new URL(fullUrl);
        sanitized.username = '';
        sanitized.password = '';
        fullUrl = sanitized.toString();

        const line = `${method} ${fullUrl} RTSP/1.0`;
        const cseq = this.cseq++;
        headers['CSeq'] = cseq.toString();

        if (this.authorization)
            headers['Authorization'] = this.authorization;

        if (this.session)
            headers['Session'] = this.session;

        this.write(line, headers, body);
    }

    async request(method: string, headers?: Headers, path?: string, body?: Buffer, authenticating?: boolean): Promise<{
        headers: Headers,
        body: Buffer
    }> {
        this.writeRequest(method, headers, path, body, authenticating);

        const response = parseHeaders(await this.readMessage());
        if (response['www-authenticate']) {
            if (authenticating)
                throw new Error('auth failed');

            const parsedUrl = new URL(this.url);

            const wwwAuth = DIGEST.parseWWWAuthenticateRest(response['www-authenticate']);

            const ha1 = crypto.createHash('md5').update(`${parsedUrl.username}:${wwwAuth.realm}:${parsedUrl.password}`).digest('hex');
            const ha2 = crypto.createHash('md5').update(`${method}:${parsedUrl.pathname}`).digest('hex');
            const hash = crypto.createHash('md5').update(`${ha1}:${wwwAuth.nonce}:${ha2}`).digest('hex');

            const params = {
                username: parsedUrl.username,
                realm: wwwAuth.realm,
                nonce: wwwAuth.nonce,
                uri: parsedUrl.pathname,
                algorithm: 'MD5',
                response: hash,
            };

            const paramsString = Object.entries(params).map(([key, value]) => `${key}=${value && quote(value)}`).join(', ');
            this.authorization = `Digest ${paramsString}`;
            return this.request(method, headers, path, body, true);
        }
        const cl = parseInt(response['content-length']);
        if (cl)
            return { headers: response, body: await readLength(this.client, cl) };
        return { headers: response, body: undefined };
    }

    async options() {
        const headers: Headers = {};
        return this.request('OPTIONS', headers);
    }

    async writeGetParameter() {
        const headers: Headers = {};
        return this.writeRequest('GET_PARAMETER', headers);
    }

    async describe(headers?: Headers) {
        return this.request('DESCRIBE', {
            ...(headers || {}),
            Accept: 'application/sdp',
        });
    }

    async setup(channel: number, path?: string) {
        const headers: any = {
            Transport: `RTP/AVP/TCP;unicast;interleaved=${channel}-${channel + 1}`,
        };
        const response = await this.request('SETUP', headers, path)
        if (response.headers.session) {
            const sessionDict: { [key: string]: string } = {};
            for (const part of response.headers.session.split(';')) {
                const [key, value] = part.split('=', 2);
                sessionDict[key] = value;
            }
            let timeout = parseInt(sessionDict['timeout']);
            if (timeout) {
                // if a timeout is requested, need to keep the session alive with periodic refresh.
                // one suggestion is calling OPTIONS, but apparently GET_PARAMETER is more reliable.
                // https://stackoverflow.com/a/39818378
                let interval = (timeout - 5) * 1000;
                let timer = setInterval(() => this.writeGetParameter(), interval);
                this.client.once('close', () => clearInterval(timer));
            }

            this.session = response.headers.session.split(';')[0];
        }
        return response;
    }

    async play() {
        const headers: any = {
            Range: 'npt=0.000-',
        };
        await this.request('PLAY', headers);
        return this.client;
    }

    async teardown() {
        try {
            return await this.request('TEARDOWN');
        }
        finally {
            this.client.destroy();
        }
    }
}

export class RtspServer {
    videoChannel = 0;
    audioChannel = 2;
    session: string;
    console: Console;
    udpPorts = {
        video: 0,
        audio: 0,
    };

    constructor(public client: Duplex, public sdp?: string, public udp?: dgram.Socket) {
        this.session = randomBytes(4).toString('hex');
        if (sdp)
            sdp = sdp.trim();
    }

    async handleSetup() {
        let currentHeaders: string[] = [];
        while (true) {
            let line = await readLine(this.client);
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

    async handleTeardown() {
        return this.handleSetup();
    }

    async *handleRecord(): AsyncGenerator<{
        type: 'audio' | 'video',
        rtcp: boolean,
        header: Buffer,
        packet: Buffer,
    }> {
        while (true) {
            const header = await readLength(this.client, 4);
            // this is the magic
            // if (header[0] !== RTSP_FRAME_MAGIC)
            //     throw new Error('RTSP frame magic expected, but got ' + header[0]);
            const length = header.readUInt16BE(2);
            const packet = await readLength(this.client, length);
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

        this.client.write(header);
        this.client.write(Buffer.from(rtp));
    }

    sendUdp(port: number, packet: Buffer, rtcp: boolean) {
        // todo: support non local host?
        this.udp.send(packet, rtcp ? port + 1 : port, '127.0.0.1');
    }

    sendVideo(packet: Buffer, rtcp: boolean) {
        if (this.udp && this.udpPorts.video) {
            this.sendUdp(this.udpPorts.video, packet, rtcp)
        }
        else {
            this.send(packet, rtcp ? this.videoChannel + 1 : this.videoChannel);
        }
    }

    sendAudio(packet: Buffer, rtcp: boolean) {
        if (this.udp && this.udpPorts.audio) {
            this.sendUdp(this.udpPorts.audio, packet, rtcp)
        }
        else {
            this.send(packet, rtcp ? this.audioChannel + 1 : this.audioChannel);
        }
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
        const transport = requestHeaders['transport'];
        headers['Transport'] = requestHeaders['transport'];
        headers['Session'] = this.session;
        if (transport.includes('UDP')) {
            const match = transport.match(/.*?client_port=([0-9]+)-([0-9]+)/);
            const [_, rtp, rtcp] = match;
            if (url.includes('audio'))
                this.udpPorts.audio = parseInt(rtp);
            else
                this.udpPorts.video = parseInt(rtp);
        }
        else if (transport.includes('TCP')) {
            const match = transport.match(/.*?interleaved=([0-9]+)-([0-9]+)/);
            if (match) {
                const low = parseInt(match[1]);
                const high = parseInt(match[2]);
                if (url.includes('audio')) {
                    this.audioChannel = low;
                }
                else {
                    this.videoChannel = low;
                }
            }
        }
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
        const sdpBuffer = await readLength(this.client, contentLength);
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

    async teardown(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['Session'] = this.session;
        this.respond(200, 'OK', requestHeaders, headers);
    }

    async headers(headers: string[]) {
        this.console?.log('request headers', headers.join('\n'));

        let [method, url] = headers[0].split(' ', 2);
        method = method.toLowerCase();
        const requestHeaders = parseHeaders(headers);
        const thisAny = this as any;
        if (!thisAny[method]) {
            this.respond(400, 'Bad Request', requestHeaders, {});
            return;
        }

        await thisAny[method](url, requestHeaders);
        return method !== 'play' && method !== 'record' && method !== 'teardown';
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
        this.console?.log('response headers', response);
        response += '\r\n';
        this.client.write(response);
        if (buffer)
            this.client.write(buffer);
    }
}
