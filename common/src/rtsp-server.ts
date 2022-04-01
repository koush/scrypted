import { readLength, readLine } from './read-stream';
import { Duplex, PassThrough, Readable } from 'stream';
import { randomBytes } from 'crypto';
import { StreamChunk, StreamParser, StreamParserOptions } from './stream-parser';
import { findTrack } from './sdp-utils';
import dgram from 'dgram';
import net from 'net';
import tls from 'tls';
import { BASIC, DIGEST } from 'http-auth-utils/dist/index';
import crypto from 'crypto';
import { timeoutPromise } from './promise-utils';

export const RTSP_FRAME_MAGIC = 36;

interface Headers {
    [header: string]: string
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

export function createRtspParser(options?: StreamParserOptions): RtspStreamParser {
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
            ...(options?.vcodec || []),
            ...(options?.acodec || []),
            '-f', 'rtsp',
        ],
        findSyncFrame(streamChunks: StreamChunk[]) {
            for (let i = 0; i < streamChunks.length; i++) {
                const chunk = streamChunks[i];
                if (chunk.type === 'rtp-video') {
                    const fragmentType = chunk.chunks[1].readUInt8(12) & 0x1f;
                    const second = chunk.chunks[1].readUInt8(13);
                    const nalType = second & 0x1f;
                    const startBit = second & 0x80;
                    if (((fragmentType === 28 || fragmentType === 29) && nalType === 5 && startBit == 128) || fragmentType == 5) {
                        return streamChunks.slice(i);
                    }
                }
            }
            return streamChunks;
        },
        sdp: new Promise<string>(r => resolve = r),
        async *parse(duplex, width, height) {
            const server = new RtspServer(duplex);
            await server.handleSetup();
            resolve(server.sdp);
            for await (const { type, rtcp, header, packet } of server.handleRecord()) {
                yield {
                    chunks: [header, packet],
                    type: `${rtcp ? 'rtcp' : 'rtp'}-${type}`,
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

export function parseSemicolonDelimited(value: string) {
    const dict: { [key: string]: string } = {};
    for (const part of value.split(';')) {
        const [key, value] = part.split('=', 2);
        dict[key] = value;
    }

    return dict;
}

export class RtspBase {
    client: net.Socket;

    constructor(public console?: Console) {
    }

    write(messageLine: string, headers: Headers, body?: Buffer) {
        let message = `${messageLine}\r\n`;
        if (body)
            headers['Content-Length'] = body.length.toString();
        for (const [key, value] of Object.entries(headers)) {
            message += `${key}: ${value}\r\n`;
        }
        message += '\r\n';
        this.client.write(message);
        this.console?.log('rtsp outgoing message\n', message);
        this.console?.log();
        if (body)
            this.client.write(body);
    }

    async readMessage(): Promise<string[]> {
        const message = await readMessage(this.client);
        this.console?.log('rtsp incoming message\n', message.join('\n'));
        this.console?.log();
        return message;
    }
}

const quote = (str: string): string => `"${str.replace(/"/g, '\\"')}"`;

// probably only works with scrypted rtsp server.
export class RtspClient extends RtspBase {
    cseq = 0;
    session: string;
    authorization: string;
    requestTimeout: number;
    rfc4571 = new PassThrough();
    needKeepAlive = false;

    constructor(public url: string, console?: Console) {
        super(console);
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

    writeRequest(method: string, headers?: Headers, path?: string, body?: Buffer) {
        headers = headers || {};

        let fullUrl = this.url;
        if (path) {
            // strangely, RTSP urls do not behave like expected from an HTTP-ish server.
            // ffmpeg will happily suffix path segments after query strings:
            // SETUP rtsp://localhost:5554/cam/realmonitor?channel=1&subtype=0/trackID=0 RTSP/1.0
            fullUrl += '/' + path;
        }

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

    async handleDataPayload(header: Buffer) {
        if (header[0] !== RTSP_FRAME_MAGIC)
            throw new Error('RTSP Client expected frame magic but received: ' + header.toString());

        const length = header.readUInt16BE(2);
        const data = await readLength(this.client, length);

        this.rfc4571.push(header);
        this.rfc4571.push(data);
    }

    async readDataPayload() {
        const header = await readLength(this.client, 4);
        return this.handleDataPayload(header);
    }

    async readLoop() {
        try {
            while (true) {
                if (this.needKeepAlive) {
                    this.needKeepAlive = false;
                    await this.getParameter();
                }
                await this.readDataPayload();
            }
        }
        catch (e) {
            this.client.destroy(e);
            this.rfc4571.destroy(e);
            throw e;
        }
    }

    // rtsp over tcp will actually interleave RTSP request/responses
    // within the RTSP data stream. The only way to tell if it's a request/response
    // is to see if the header + data starts with RTSP/1.0 message line.
    // Or RTSP, if looking at only the header bytes. Then grab the response out.
    async readMessage(): Promise<string[]> {
        while (true) {
            const header = await readLength(this.client, 4);
            if (header.toString() === 'RTSP') {
                this.client.unshift(header);
                const message = await super.readMessage();
                this.console?.log('rtsp incoming message\n', message.join('\n'));
                this.console?.log();
                return message;
            }

            await this.handleDataPayload(header);
        }
    }

    async request(method: string, headers?: Headers, path?: string, body?: Buffer, authenticating?: boolean): Promise<{
        headers: Headers,
        body: Buffer
    }> {
        this.writeRequest(method, headers, path, body);

        const message = this.requestTimeout ? await timeoutPromise(this.requestTimeout, this.readMessage()) : await this.readMessage();
        const status = message[0];
        const response = parseHeaders(message);
        if (!status.includes('200') && !response['www-authenticate'])
            throw new Error(status);

        const wwwAuthenticate = response['www-authenticate']
        if (wwwAuthenticate) {
            if (authenticating)
                throw new Error('auth failed');

            const parsedUrl = new URL(this.url);

            if (wwwAuthenticate.includes('Basic')) {
                const hash = BASIC.computeHash(parsedUrl);
                this.authorization = `Basic ${hash}`;
            }
            else {
                const wwwAuth = DIGEST.parseWWWAuthenticateRest(wwwAuthenticate);

                const username = decodeURIComponent(parsedUrl.username);
                const password = decodeURIComponent(parsedUrl.password);

                const ha1 = crypto.createHash('md5').update(`${username}:${wwwAuth.realm}:${password}`).digest('hex');
                const ha2 = crypto.createHash('md5').update(`${method}:${parsedUrl.pathname}`).digest('hex');
                const hash = crypto.createHash('md5').update(`${ha1}:${wwwAuth.nonce}:${ha2}`).digest('hex');

                const params = {
                    username,
                    realm: wwwAuth.realm,
                    nonce: wwwAuth.nonce,
                    uri: parsedUrl.pathname,
                    algorithm: 'MD5',
                    response: hash,
                };

                const paramsString = Object.entries(params).map(([key, value]) => `${key}=${value && quote(value)}`).join(', ');
                this.authorization = `Digest ${paramsString}`;
            }

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

    async getParameter() {
        return this.request('GET_PARAMETER');
    }

    async describe(headers?: Headers) {
        return this.request('DESCRIBE', {
            ...(headers || {}),
            Accept: 'application/sdp',
        });
    }

    async setup(channelOrPort: number, path?: string, udp?: boolean) {
        const protocol = udp ? 'UDP' : 'TCP';
        const client = udp ? 'client_port' : 'interleaved';
        const headers: any = {
            Transport: `RTP/AVP/${protocol};unicast;${client}=${channelOrPort}-${channelOrPort + 1}`,
        };
        const response = await this.request('SETUP', headers, path)
        if (response.headers.session) {
            const sessionDict = parseSemicolonDelimited(response.headers.session);
            let timeout = parseInt(sessionDict['timeout']);
            if (timeout) {
                // if a timeout is requested, need to keep the session alive with periodic refresh.
                // one suggestion is calling OPTIONS, but apparently GET_PARAMETER is more reliable.
                // https://stackoverflow.com/a/39818378
                let interval = (timeout - 5) * 1000;
                let timer = setInterval(() => this.needKeepAlive = true, interval);
                this.client.once('close', () => clearInterval(timer));
            }

            this.session = response.headers.session.split(';')[0];
        }
        return response;
    }

    async play(start: string = '0.000') {
        const headers: any = {
            Range: `npt=${start}-`,
        };
        return this.request('PLAY', headers);
    }

    async pause() {
        return this.request('PAUSE');
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
    videoChannel: number;
    audioChannel: number;
    session: string;
    console: Console;
    udpPorts = {
        video: 0,
        audio: 0,
    };

    constructor(public client: Duplex, public sdp?: string, public udp?: dgram.Socket, public checkRequest?: (method: string, url: string, headers: Headers, rawMessage: string[]) => Promise<boolean>) {
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
            // can this even happen? since the RTSP request method isn't a fixed
            // value like the "RTSP" in the RTSP response, I don't think so?
            if (header[0] !== RTSP_FRAME_MAGIC)
                throw new Error('RTSP Server expected frame magic but received: ' + header.toString());
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
            if (this.videoChannel == null)
                throw new Error('rtsp videoChannel not set up');
            this.send(packet, rtcp ? this.videoChannel + 1 : this.videoChannel);
        }
    }

    sendAudio(packet: Buffer, rtcp: boolean) {
        if (this.udp && this.udpPorts.audio) {
            this.sendUdp(this.udpPorts.audio, packet, rtcp)
        }
        else {
            if (this.audioChannel == null)
                throw new Error('rtsp audioChannel not set up');
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

    // todo: use the sdp itself to determine the audio/video track ids so
    // rewriting is not necessary.
    setup(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        const transport = requestHeaders['transport'];
        headers['Transport'] = transport;
        headers['Session'] = this.session;
        let audioTrack = findTrack(this.sdp, 'audio');
        let videoTrack = findTrack(this.sdp, 'video');
        if (transport.includes('UDP')) {
            if (!this.udp) {
                this.respond(461, 'Unsupported Transport', requestHeaders, {});
                return;
            }
            const match = transport.match(/.*?client_port=([0-9]+)-([0-9]+)/);
            const [_, rtp, rtcp] = match;
            if (audioTrack && url.includes(audioTrack.trackId))
                this.udpPorts.audio = parseInt(rtp);
            else if (videoTrack && url.includes(videoTrack.trackId))
                this.udpPorts.video = parseInt(rtp);
            else
                this.console?.warn('unknown track id', url);
        }
        else if (transport.includes('TCP')) {
            const match = transport.match(/.*?interleaved=([0-9]+)-([0-9]+)/);
            if (match) {
                const low = parseInt(match[1]);
                const high = parseInt(match[2]);

                if (audioTrack && url.includes(audioTrack.trackId))
                    this.audioChannel = low;
                else if (videoTrack && url.includes(videoTrack.trackId))
                    this.videoChannel = low;
                else
                    this.console?.warn('unknown track id', url);
            }
        }
        this.respond(200, 'OK', requestHeaders, headers)
    }

    play(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        let audioTrack = findTrack(this.sdp, 'audio');
        let videoTrack = findTrack(this.sdp, 'video');
        let rtpInfo = '';
        if (audioTrack)
            rtpInfo = `url=${url}/trackID=${audioTrack.trackId};seq=0;rtptime=0`
        if (audioTrack && videoTrack)
            rtpInfo += ',';
        if (videoTrack)
            rtpInfo += `url=${url}/trackID=${videoTrack.trackId};seq=0;rtptime=0`;
        headers['RTP-Info'] = rtpInfo;
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
        if (this.checkRequest) {
            let allow: boolean;
            try {
                allow = await this.checkRequest(method, url, requestHeaders, headers)
            }
            catch (e) {
                this.console?.error('error checking request', e);
            }
            if (!allow) {
                this.respond(400, 'Bad Request', requestHeaders, {});
                this.client.destroy();
                throw new Error('check request failed');
            }
        }

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
