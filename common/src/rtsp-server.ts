import crypto, { randomBytes } from 'crypto';
import dgram from 'dgram';
import { BASIC, DIGEST } from 'http-auth-utils/dist/index';
import net from 'net';
import { Duplex, PassThrough, Readable } from 'stream';
import tls from 'tls';
import { timeoutPromise } from './promise-utils';
import { readLength, readLine } from './read-stream';
import { parseSdp } from './sdp-utils';
import { sleep } from './sleep';
import { StreamChunk, StreamParser, StreamParserOptions } from './stream-parser';

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

// https://yumichan.net/video-processing/video-compression/introduction-to-h264-nal-unit/

export const H264_NAL_TYPE_IDR = 5;
export const H264_NAL_TYPE_SEI = 6;
export const H264_NAL_TYPE_SPS = 7;
// aggregate NAL Unit
export const H264_NAL_TYPE_STAP_A = 24;
// fragmented NAL Unit (need to match against first)
export const H264_NAL_TYPE_FU_A = 28;

export function findH264NaluType(streamChunk: StreamChunk, naluType: number) {
    if (streamChunk.type !== 'h264')
        return;

    const nalu = streamChunk.chunks[streamChunk.chunks.length - 1].subarray(12);
    const checkNaluType = nalu[0] & 0x1f;
    if (checkNaluType === H264_NAL_TYPE_STAP_A) {
        let pos = 1;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = nalu[pos] & 0x1f;
            if (stapaType === naluType)
                return nalu.subarray(pos, pos + naluLength);
            pos += naluLength;
        }
    }
    else if (checkNaluType === H264_NAL_TYPE_FU_A) {
        const fuaType = nalu[1] & 0x1f;
        const isFuStart = !!(nalu[1] & 0x80);

        if (fuaType === naluType && isFuStart)
            return nalu.subarray(1);
    }
    else if (checkNaluType === naluType) {
        return nalu;
    }
    return;
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
            let foundIndex: number;
            let nonVideo: {
                [codec: string]: StreamChunk,
            } = {};

            const createSyncFrame = () => {
                const ret = streamChunks.slice(foundIndex);
                // for (const nv of Object.values(nonVideo)) {
                //     ret.unshift(nv);
                // }
                return ret;
            }

            for (let prebufferIndex = 0; prebufferIndex < streamChunks.length; prebufferIndex++) {
                const streamChunk = streamChunks[prebufferIndex];
                if (streamChunk.type !== 'h264') {
                    nonVideo[streamChunk.type] = streamChunk;
                    continue;
                }

                if (findH264NaluType(streamChunk, H264_NAL_TYPE_SPS))
                    foundIndex = prebufferIndex;
            }

            if (foundIndex !== undefined)
                return createSyncFrame();

            nonVideo = {};
            // some streams don't contain codec info, so find an idr frame instead.
            for (let prebufferIndex = 0; prebufferIndex < streamChunks.length; prebufferIndex++) {
                const streamChunk = streamChunks[prebufferIndex];
                if (streamChunk.type !== 'h264') {
                    nonVideo[streamChunk.type] = streamChunk;
                    continue;
                }
                if (findH264NaluType(streamChunk, H264_NAL_TYPE_IDR))
                    foundIndex = prebufferIndex;
            }

            if (foundIndex !== undefined)
                return createSyncFrame();

            // oh well!
        },
        sdp: new Promise<string>(r => resolve = r),
        async *parse(duplex, width, height) {
            const server = new RtspServer(duplex);
            await server.handleSetup();
            resolve(server.sdp);
            for await (const { type, rtcp, header, packet } of server.handleRecord()) {
                yield {
                    chunks: [header, packet],
                    type: `${rtcp ? 'rtcp-' : ''}${type}`,
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

export interface RtspClientSetupOptions {
    type: 'tcp' | 'udp';
    port: number;
    path?: string;
}

export interface RtspClientTcpSetupOptions extends RtspClientSetupOptions {
    type: 'tcp';
    onRtp: (rtspHeader: Buffer, rtp: Buffer) => void;
}

export interface RtspClientUdpSetupOptions extends RtspClientSetupOptions {
    type: 'udp';
}

// probably only works with scrypted rtsp server.
export class RtspClient extends RtspBase {
    cseq = 0;
    session: string;
    wwwAuthenticate: string;
    requestTimeout: number;
    needKeepAlive = false;
    setupOptions = new Map<number, RtspClientTcpSetupOptions>();
    issuedTeardown = false;

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

    async safeTeardown() {
        // issue a teardown to upstream to close gracefully
        if (this.issuedTeardown)
            return;
        this.issuedTeardown = true;
        try {
            this.writeTeardown();
            await sleep(500);
        }
        catch (e) {
        }
        finally {
            // will trigger after teardown returns
            this.client.destroy();
        }
    }

    writeRequest(method: string, headers?: Headers, path?: string, body?: Buffer) {
        headers = headers || {};

        let fullUrl = this.url;
        if (path) {
            // a=control may be a full or "relative" url.
            if (path.includes('rtsp://') || path.includes('rtsps://')) {
                fullUrl = path;
            }
            else {
                // strangely, relative RTSP urls do not behave like expected from an HTTP-ish server.
                // ffmpeg will happily suffix path segments after query strings:
                // SETUP rtsp://localhost:5554/cam/realmonitor?channel=1&subtype=0/trackID=0 RTSP/1.0
                fullUrl += (fullUrl.endsWith('/') ? '' : '/') + path;
            }
        }

        const sanitized = new URL(fullUrl);
        sanitized.username = '';
        sanitized.password = '';

        const line = `${method} ${sanitized} RTSP/1.0`;
        const cseq = this.cseq++;
        headers['CSeq'] = cseq.toString();
        headers['User-Agent'] = 'Scrypted';

        if (this.wwwAuthenticate)
            headers['Authorization'] = this.createAuthorizationHeader(method, new URL(fullUrl));

        if (this.session)
            headers['Session'] = this.session;

        this.write(line, headers, body);
    }

    async handleDataPayload(header: Buffer) {
        // todo: fix this, because calling teardown outside of the read loop causes this.
        if (header[0] !== RTSP_FRAME_MAGIC)
            throw new Error('RTSP Client expected frame magic but received: ' + header.toString());

        const channel = header.readUInt8(1);
        const length = header.readUInt16BE(2);
        const data = await readLength(this.client, length);

        const options = this.setupOptions.get(channel);
        options?.onRtp?.(header, data);
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
                return message;
            }

            await this.handleDataPayload(header);
        }
    }

    createAuthorizationHeader(method: string, url: URL) {
        if (!this.wwwAuthenticate)
            throw new Error('no WWW-Authenticate found');

        if (this.wwwAuthenticate.includes('Basic')) {
            const hash = BASIC.computeHash(url);
            return `Basic ${hash}`;
        }

        const wwwAuth = DIGEST.parseWWWAuthenticateRest(this.wwwAuthenticate);

        const authedUrl = new URL(this.url);
        const username = decodeURIComponent(authedUrl.username);
        const password = decodeURIComponent(authedUrl.password);

        const strippedUrl = new URL(url);
        strippedUrl.username = '';
        strippedUrl.password = '';

        const ha1 = crypto.createHash('md5').update(`${username}:${wwwAuth.realm}:${password}`).digest('hex');
        const ha2 = crypto.createHash('md5').update(`${method}:${strippedUrl}`).digest('hex');
        const hash = crypto.createHash('md5').update(`${ha1}:${wwwAuth.nonce}:${ha2}`).digest('hex');


        const params = {
            username,
            realm: wwwAuth.realm,
            nonce: wwwAuth.nonce,
            uri: strippedUrl.toString(),
            algorithm: 'MD5',
            response: hash,
        };

        const paramsString = Object.entries(params).map(([key, value]) => `${key}=${value && quote(value)}`).join(', ');
        return `Digest ${paramsString}`;
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

            this.wwwAuthenticate = wwwAuthenticate;

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

    writeGetParameter() {
        return this.writeRequest('GET_PARAMETER');
    }

    async describe(headers?: Headers) {
        return this.request('DESCRIBE', {
            ...(headers || {}),
            Accept: 'application/sdp',
        });
    }

    async setup(options: RtspClientTcpSetupOptions | RtspClientUdpSetupOptions) {
        const protocol = options.type === 'udp' ? 'UDP' : 'TCP';
        const client = options.type === 'udp' ? 'client_port' : 'interleaved';
        const headers: any = {
            Transport: `RTP/AVP/${protocol};unicast;${client}=${options.port}-${options.port + 1}`,
        };
        const response = await this.request('SETUP', headers, options.path);
        let interleaved: {
            begin: number;
            end: number;
        };
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
        if (response.headers.transport) {
            const match = response.headers.transport.match(/.*?interleaved=([0-9]+)-([0-9]+)/);
            if (match) {
                const [_, begin, end] = match;
                if (begin && end) {
                    interleaved = {
                        begin: parseInt(begin),
                        end: parseInt(end),
                    };
                }
            }
        }
        if (options.type === 'tcp')
            this.setupOptions.set(interleaved.begin, options);
        return Object.assign({ interleaved }, response);
    }

    async play(start: string = '0.000') {
        const headers: any = {
            Range: `npt=${start}-`,
        };
        return this.request('PLAY', headers);
    }

    writePlay(start: string = '0.000') {
        const headers: any = {
            Range: `npt=${start}-`,
        };
        return this.writeRequest('PLAY', headers);
    }

    async pause() {
        return this.request('PAUSE');
    }

    async teardown() {
        try {
            // todo: fix this, because calling teardown outside of the read loop causes this.
            return await this.request('TEARDOWN');
        }
        finally {
            this.client.destroy();
        }
    }

    writeTeardown() {
        this.writeRequest('TEARDOWN');
    }
}

export interface RtspTrack {
    protocol: 'tcp' | 'udp';
    destination: number;
    codec: string;
    control: string;
}

export class RtspServer {
    session: string;
    console: Console;
    setupTracks: {
        [trackId: string]: RtspTrack;
    } = {};

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
        type: string,
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
            const destination = id - (id % 2);
            const track = Object.values(this.setupTracks).find(track => track.destination === destination);
            if (!track)
                throw new Error('RSTP Server received unknown channel: ' + id);

            yield {
                type: track.codec,
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

    sendTrack(trackId: string, packet: Buffer, rtcp: boolean) {
        const track = this.setupTracks[trackId];
        if (!track) {
            this.console?.warn('RTSP Server track not found:', trackId);
            return;
        }

        if (track.protocol === 'udp') {
            if (!this.udp)
                this.console?.warn('RTSP Server UDP socket not available.');
            else
                this.sendUdp(track.destination, packet, rtcp);
            return;
        }

        this.send(packet, rtcp ? track.destination + 1 : track.destination);
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
        const parsedSdp = parseSdp(this.sdp);
        const msection = parsedSdp.msections.find(msection => url.endsWith(msection.control));
        if (!msection) {
            this.respond(404, 'Not Found', requestHeaders, headers);
            return;
        }

        if (transport.includes('UDP')) {
            if (!this.udp) {
                this.respond(461, 'Unsupported Transport', requestHeaders, {});
                return;
            }
            const match = transport.match(/.*?client_port=([0-9]+)-([0-9]+)/);
            const [_, rtp, rtcp] = match;
            this.setupTracks[msection.control] = {
                control: msection.control,
                protocol: 'udp',
                destination: parseInt(rtp),
                codec: msection.codec,
            }
        }
        else if (transport.includes('TCP')) {
            const match = transport.match(/.*?interleaved=([0-9]+)-([0-9]+)/);
            if (match) {
                const low = parseInt(match[1]);
                const high = parseInt(match[2]);
                this.setupTracks[msection.control] = {
                    control: msection.control,
                    protocol: 'tcp',
                    destination: low,
                    codec: msection.codec,
                }
            }
        }
        this.respond(200, 'OK', requestHeaders, headers)
    }

    play(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        const rtpInfos = Object.values(this.setupTracks).map(track => `url=${url}/${track.control}`);
        const rtpInfo = rtpInfos.join(',') + ';seq=0;rtptime=0';
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
        if (buffer) {
            this.client.write(buffer);
            this.console?.log('response body', buffer.toString());
        }
    }
}
