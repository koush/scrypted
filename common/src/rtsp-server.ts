import crypto, { randomBytes } from 'crypto';
import dgram from 'dgram';
import { once } from 'events';
import net from 'net';
import { Duplex, Readable, Writable } from 'stream';
import tls from 'tls';
import { URL } from 'url';
import { Deferred } from './deferred';
import { closeQuiet, createBindZero, createSquentialBindZero, listenZeroSingleClient } from './listen-cluster';
import { timeoutPromise } from './promise-utils';
import { readLength, readLine } from './read-stream';
import { MSection, parseSdp } from './sdp-utils';
import { sleep } from './sleep';
import { StreamChunk, StreamParser, StreamParserOptions } from './stream-parser';

const REQUIRED_WWW_AUTHENTICATE_KEYS = ['realm', 'nonce'];

type DigestWWWAuthenticateData = {
    realm: string;
    domain?: string;
    nonce: string;
    opaque?: string;
    stale?: 'true' | 'false';
    algorithm?: 'MD5' | 'MD5-sess' | 'token';
    qop?: 'auth' | 'auth-int' | string;
};

export const RTSP_FRAME_MAGIC = 36;

export interface Headers {
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


export async function readBody(client: Readable, response: Headers) {
    const cl = parseInt(response['content-length']);
    if (cl)
        return readLength(client, cl)
}


export function writeMessage(client: Writable, messageLine: string, body: Buffer, headers: Headers, console?: Console) {
    let message = messageLine !== undefined ? `${messageLine}\r\n` : '';
    if (body)
        headers['Content-Length'] = body.length.toString();
    for (const [key, value] of Object.entries(headers)) {
        message += `${key}: ${value}\r\n`;
    }
    message += '\r\n';
    client.write(message);
    console?.log('rtsp outgoing message\n', message);
    console?.log();
    if (body)
        client.write(body);
}

// https://yumichan.net/video-processing/video-compression/introduction-to-h264-nal-unit/

export const H264_NAL_TYPE_RESERVED0 = 0;
export const H264_NAL_TYPE_RESERVED30 = 30;
export const H264_NAL_TYPE_RESERVED31 = 31;

export const H264_NAL_TYPE_IDR = 5;
export const H264_NAL_TYPE_SEI = 6;
export const H264_NAL_TYPE_SPS = 7;
export const H264_NAL_TYPE_PPS = 8;
// aggregate NAL Unit
export const H264_NAL_TYPE_STAP_A = 24;
export const H264_NAL_TYPE_STAP_B = 25;
// fragmented NAL Unit (need to match against first)
export const H264_NAL_TYPE_FU_A = 28;
export const H264_NAL_TYPE_FU_B = 29;

export const H264_NAL_TYPE_MTAP16 = 26;
export const H264_NAL_TYPE_MTAP32 = 27;

export const H265_NAL_TYPE_AGG = 48;
export const H265_NAL_TYPE_VPS = 32;
export const H265_NAL_TYPE_SPS = 33;
export const H265_NAL_TYPE_PPS = 34;
export const H265_NAL_TYPE_IDR_N = 19;
export const H265_NAL_TYPE_IDR_W = 20;
export const H265_NAL_TYPE_FU = 49;
export const H265_NAL_TYPE_SEI_PREFIX = 39;
export const H265_NAL_TYPE_SEI_SUFFIX = 40;

export function findH264NaluType(streamChunk: StreamChunk, naluType: number) {
    if (streamChunk.type !== 'h264')
        return;
    return findH264NaluTypeInNalu(streamChunk.chunks[streamChunk.chunks.length - 1].subarray(12), naluType);
}

export function findH265NaluType(streamChunk: StreamChunk, naluType: number) {
    if (streamChunk.type !== 'h265')
        return;
    return findH265NaluTypeInNalu(streamChunk.chunks[streamChunk.chunks.length - 1].subarray(12), naluType);
}

export function parseH264NaluType(firstNaluByte: number) {
    return firstNaluByte & 0x1f;
}

export function findH264NaluTypeInNalu(nalu: Buffer, naluType: number) {
    const checkNaluType = parseH264NaluType(nalu[0]);
    if (checkNaluType === H264_NAL_TYPE_STAP_A) {
        let pos = 1;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH264NaluType(nalu[pos]);
            if (stapaType === naluType)
                return nalu.subarray(pos, pos + naluLength);
            pos += naluLength;
        }
    }
    else if (checkNaluType === H264_NAL_TYPE_FU_A) {
        const fuaType = parseH264NaluType(nalu[1]);
        const isFuStart = !!(nalu[1] & 0x80);

        if (fuaType === naluType && isFuStart)
            return nalu.subarray(1);
    }
    else if (checkNaluType === naluType) {
        return nalu;
    }
    return;
}

function parseH265NaluType(firstNaluByte: number) {
    return (firstNaluByte & 0b01111110) >> 1;
}

export function findH265NaluTypeInNalu(nalu: Buffer, naluType: number) {
    const checkNaluType = parseH265NaluType(nalu[0]);
    if (checkNaluType === H265_NAL_TYPE_AGG) {
        let pos = 1;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH265NaluType(nalu[pos]);
            if (stapaType === naluType)
                return nalu.subarray(pos, pos + naluLength);
            pos += naluLength;
        }
    }
    else if (checkNaluType === naluType) {
        return nalu;
    }
    return;
}

export function getNaluTypes(streamChunk: StreamChunk) {
    if (streamChunk.type !== 'h264')
        return new Set<number>();
    return getNaluTypesInNalu(streamChunk.chunks[streamChunk.chunks.length - 1].subarray(12))
}

export function getNaluTypesInNalu(nalu: Buffer, fuaRequireStart = false, fuaRequireEnd = false) {
    const ret = new Set<number>();
    const naluType = parseH264NaluType(nalu[0]);
    if (naluType === H264_NAL_TYPE_STAP_A) {
        ret.add(H264_NAL_TYPE_STAP_A);
        let pos = 1;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH264NaluType(nalu[pos]);
            ret.add(stapaType);
            pos += naluLength;
        }
    }
    else if (naluType === H264_NAL_TYPE_FU_A) {
        ret.add(H264_NAL_TYPE_FU_A);
        const fuaType = parseH264NaluType(nalu[1]);
        if (fuaRequireStart) {
            const isFuStart = !!(nalu[1] & 0x80);
            if (isFuStart)
                ret.add(fuaType);
        }
        else if (fuaRequireEnd) {
            const isFuEnd = !!(nalu[1] & 0x40);
            if (isFuEnd)
                ret.add(fuaType);
        }
        else {
            ret.add(fuaType);
        }
    }
    else {
        ret.add(naluType);
    }

    return ret;
}

export function getH265NaluTypes(streamChunk: StreamChunk) {
    if (streamChunk.type !== 'h265')
        return new Set<number>();
    return getNaluTypesInH265Nalu(streamChunk.chunks[streamChunk.chunks.length - 1].subarray(12))
}

export function getNaluTypesInH265Nalu(nalu: Buffer, fuaRequireStart = false, fuaRequireEnd = false) {
    const ret = new Set<number>();
    const naluType = parseH265NaluType(nalu[0]);
    if (naluType === H265_NAL_TYPE_AGG) {
        ret.add(H265_NAL_TYPE_AGG);
        let pos = 2;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH265NaluType(nalu[pos]);
            ret.add(stapaType);
            pos += naluLength;
        }
    }
    else if (naluType === H265_NAL_TYPE_FU) {
        ret.add(H265_NAL_TYPE_FU);
        const fuaType = nalu[2] & 0x3F;  // 6 bits
        if (fuaRequireStart) {
            const isFuStart = !!(nalu[2] & 0x80);
            if (isFuStart)
                ret.add(fuaType);
        }
        else if (fuaRequireEnd) {
            const isFuEnd = !!(nalu[2] & 0x40);
            if (isFuEnd)
                ret.add(fuaType);
        }
        else {
            ret.add(fuaType);
        }
    }
    else {
        ret.add(naluType);
    }

    return ret;
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
            // linux and windows seem to support 64000 but darwin is 32000?
            '-pkt_size', '32000',
            '-f', 'rtsp',
        ],
        findSyncFrame(streamChunks: StreamChunk[]) {
            for (let prebufferIndex = 0; prebufferIndex < streamChunks.length; prebufferIndex++) {
                const streamChunk = streamChunks[prebufferIndex];
                if (streamChunk.type === 'h264') {
                    const naluTypes = getNaluTypes(streamChunk);
                    if (naluTypes.has(H264_NAL_TYPE_SPS) || naluTypes.has(H264_NAL_TYPE_IDR)) {
                        return streamChunks.slice(prebufferIndex);
                    }
                }
                else if (streamChunk.type === 'h265') {
                    const naluTypes = getH265NaluTypes(streamChunk);

                    if (naluTypes.has(H265_NAL_TYPE_VPS)
                        || naluTypes.has(H265_NAL_TYPE_SPS)
                        || naluTypes.has(H265_NAL_TYPE_PPS)
                        || naluTypes.has(H265_NAL_TYPE_IDR_N)
                        || naluTypes.has(H265_NAL_TYPE_IDR_W)
                    ) {
                        return streamChunks.slice(prebufferIndex);
                    }
                }
            }

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

export function getFirstAuthenticateHeader(headers: string[]): string {
    for (const header of headers.slice(1)) {
        const index = header.indexOf(':');
        let value = '';
        if (index !== -1)
            value = header.substring(index + 1).trim();
        const key = header.substring(0, index).toLowerCase();
        if (key === 'www-authenticate')
            return value;
    }
}

export function parseSemicolonDelimited(value: string) {
    const dict: { [key: string]: string } = {};
    for (const part of value.split(';')) {
        const [key, value] = part.split('=', 2);
        dict[key] = value;
    }

    return dict;
}

export interface RtspStatus {
    line: string,
    code: number,
    version: string,
    reason: string,
}

export interface RtspServerResponse {
    headers: Headers;
    body: Buffer;
    status: RtspStatus;
}

export class RtspStatusError extends Error {
    constructor(public status: RtspStatus) {
        super(`RTSP Error: ${status.line}`);
    }
}

export class RtspBase {
    client: net.Socket;
    console?: Console;

    constructor() {
    }

    write(messageLine: string, headers: Headers, body?: Buffer) {
        writeMessage(this.client, messageLine, body, headers, this.console);
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
    path?: string;
    onRtp: (rtspHeader: Buffer, rtp: Buffer) => void;
}

export interface RtspClientTcpSetupOptions extends RtspClientSetupOptions {
    type: 'tcp';
    port: number;
}

export interface RtspClientUdpSetupOptions extends RtspClientSetupOptions {
    type: 'udp';
    dgram?: dgram.Socket;
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
    hasGetParameter = true;
    contentBase: string;

    constructor(public readonly url: string) {
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
        this.client.on('error', e => {
            this.console?.log('client error', e);
        });
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

    async writeRequest(method: string, headers?: Headers, path?: string, body?: Buffer) {
        headers = headers || {};

        let fullUrl: string;
        if (!path) {
            fullUrl = this.url;
        }
        else {
            // a=control may be a full or "relative" url.
            if (path.includes('rtsp://') || path.includes('rtsps://') || path === '*') {
                fullUrl = path;
            }
            else {
                fullUrl = this.contentBase || this.url;

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
            headers['Authorization'] = await this.createAuthorizationHeader(method, new URL(fullUrl));

        if (this.session)
            headers['Session'] = this.session;

        this.write(line, headers, body);
    }

    async handleDataPayload(header: Buffer) {
        // todo: fix this, because calling teardown outside of the read loop causes this.
        if (header[0] !== RTSP_FRAME_MAGIC)
            throw new Error('RTSP Client received invalid frame magic. This may be a bug in your camera firmware. If this error persists, switch your RTSP Parser to FFmpeg or Scrypted (UDP): ' + header.toString());

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

    createBadHeader(header: Buffer) {
        return new Error('RTSP Client received invalid frame magic. This may be a bug in your camera firmware. If this error persists, switch your RTSP Parser to FFmpeg or Scrypted (UDP): ' + header.toString());
    }

    async readLoopLegacy() {
        try {
            while (true) {
                if (this.needKeepAlive) {
                    this.needKeepAlive = false;
                    if (this.hasGetParameter)
                        await this.getParameter();
                    else
                        await this.options();
                }
                await this.readDataPayload();
            }
        }
        catch (e) {
            this.client.destroy(e as Error);
            throw e;
        }
    }

    async *handleStream(): AsyncGenerator<{
        rtcp: boolean,
        header: Buffer,
        packet: Buffer,
        channel: number,
    }> {
        while (true) {
            const header = await readLength(this.client, 4);
            // can this even happen? since the RTSP request method isn't a fixed
            // value like the "RTSP" in the RTSP response, I don't think so?
            if (header[0] !== RTSP_FRAME_MAGIC) {
                if (header.toString() !== 'RTSP')
                    throw this.createBadHeader(header);

                this.client.unshift(header);

                // do what with this?
                const message = await super.readMessage();
                const body = await this.readBody(parseHeaders(message));

                continue;
            }

            const length = header.readUInt16BE(2);
            const packet = await readLength(this.client, length);
            const id = header.readUInt8(1);

            yield {
                channel: id,
                rtcp: id % 2 === 1,
                header,
                packet,
            }
        }
    }

    async readLoop() {
        const deferred = new Deferred<void>();

        let header: Buffer;
        let channel: number;
        let length: number;

        const read = async () => {
            if (this.needKeepAlive) {
                this.needKeepAlive = false;
                if (this.hasGetParameter)
                    this.writeGetParameter();
                else
                    this.writeOptions();
            }

            try {
                while (true) {
                    // get header if needed
                    if (!header) {
                        header = this.client.read(4);

                        if (!header)
                            return;

                        // validate header once.
                        if (header[0] !== RTSP_FRAME_MAGIC) {
                            if (header.toString() !== 'RTSP')
                                throw this.createBadHeader(header);

                            this.client.unshift(header);
                            header = undefined;

                            // remove the listener to operate in pull mode.
                            this.client.removeListener('readable', read);

                            // do what with this?
                            const message = await super.readMessage();
                            const body = await this.readBody(parseHeaders(message));

                            // readd the listener to operate in streaming mode.
                            this.client.on('readable', read);

                            continue;
                        }

                        channel = header.readUInt8(1);
                        length = header.readUInt16BE(2);
                    }

                    const data = this.client.read(length);
                    if (!data)
                        return;

                    const h = header;
                    header = undefined;
                    const options = this.setupOptions.get(channel);
                    options?.onRtp?.(h, data);
                }
            }
            catch (e) {
                if (!deferred.finished)
                    deferred.reject(e as Error);
                this.client.destroy();
            }
        };

        read();
        this.client.on('readable', read);

        await Promise.all([once(this.client, 'end')]);
    }

    // rtsp over tcp will actually interleave RTSP request/responses
    // within the RTSP data stream. The only way to tell if it's a request/response
    // is to see if the header + data starts with RTSP/1.0 message line.
    // Or RTSP, if looking at only the header bytes. Then grab the response out.
    async readMessage(): Promise<string[]> {
        while (true) {
            const header = await readLength(this.client, 4);
            if (header[0] !== RTSP_FRAME_MAGIC) {
                if (header.toString() === 'RTSP') {
                    this.client.unshift(header);
                    const message = await super.readMessage();
                    return message;
                }
                throw this.createBadHeader(header);
            }

            await this.handleDataPayload(header);
        }
    }

    async createAuthorizationHeader(method: string, url: URL) {
        if (!this.wwwAuthenticate)
            throw new Error('no WWW-Authenticate found');

        const { BASIC } = await import('http-auth-utils');
        // @ts-ignore
        const { parseHTTPHeadersQuotedKeyValueSet } = await import('http-auth-utils/dist/utils');

        if (this.wwwAuthenticate.includes('Basic')) {
            const parsedUrl = new URL(this.url);
            const hash = BASIC.computeHash({ username: parsedUrl.username, password: parsedUrl.password });
            return `Basic ${hash}`;
        }

        // hikvision sends out of spec 'random' name and value parameter,
        // which causes the digest auth lib to fail. so, need to parse the header
        // manually with a relax set of authorized parameters.
        // https://github.com/koush/scrypted/issues/344#issuecomment-1223627956
        // https://github.com/nfroidure/http-auth-utils/blob/7532d21a419ad098d1240c9e1b55855020df5d7f/src/mechanisms/digest.ts#L97
        // const wwwAuth = DIGEST.parseWWWAuthenticateRest(this.wwwAuthenticate);
        const wwwAuth = parseHTTPHeadersQuotedKeyValueSet(
            this.wwwAuthenticate,
            // the parser will call indexOf to see if the key is authorized. monkey patch this call.
            // https://github.com/nfroidure/http-auth-utils/blob/17186d3eefb86535916d044c7f59a340bc765603/src/utils.ts#L43
            {
                indexOf: () => 0,
            } as any,
            REQUIRED_WWW_AUTHENTICATE_KEYS,
        ) as DigestWWWAuthenticateData;

        const authedUrl = new URL(this.url);
        const username = decodeURIComponent(authedUrl.username);
        const password = decodeURIComponent(authedUrl.password);

        const strippedUrl = new URL(url.toString());
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

    async readBody(response: Headers) {
        return readBody(this.client, response);
    }

    async request(method: string, headers?: Headers, path?: string, body?: Buffer, authenticating?: boolean): Promise<RtspServerResponse> {
        await this.writeRequest(method, headers, path, body);

        const message = this.requestTimeout ? await timeoutPromise(this.requestTimeout, this.readMessage()) : await this.readMessage();
        const statusLine = message[0];
        const [version, codeString, reason] = statusLine.split(' ', 3);
        const code = parseInt(codeString);
        const response = parseHeaders(message);

        const status = {
            line: statusLine,
            code,
            version,
            reason,
        };

        if (code !== 200 && !response['www-authenticate'])
            throw new RtspStatusError(status);

        // it seems that the first www-authenticate header should be used, as latter ones that are
        // offered are not actually valid? weird issue seen on tp-link that offers both DIGEST and BASIC.
        const wwwAuthenticate = getFirstAuthenticateHeader(message) || response['www-authenticate']
        if (wwwAuthenticate) {
            if (authenticating)
                throw new Error('auth failed');

            this.wwwAuthenticate = wwwAuthenticate;

            return this.request(method, headers, path, body, true);
        }
        return {
            headers: response,
            body: await this.readBody(response),
            status,
        }
    }

    async options() {
        const headers: Headers = {};
        const ret = await this.request('OPTIONS', headers);
        const publicHeader = ret.headers['public'];
        if (publicHeader)
            this.hasGetParameter = publicHeader.toLowerCase().includes('get_parameter');
        return ret;
    }

    writeOptions() {
        return this.writeRequest('OPTIONS');
    }

    async getParameter() {
        return this.request('GET_PARAMETER');
    }

    writeGetParameter() {
        return this.writeRequest('GET_PARAMETER');
    }

    async describe(headers?: Headers) {
        const response = await this.request('DESCRIBE', {
            ...(headers || {}),
            Accept: 'application/sdp',
        });

        this.contentBase = response.headers['content-base'] || response.headers['content-location'];
        // content base may be a relative path? seems odd.
        if (this.contentBase)
            this.contentBase = new URL(this.contentBase, this.url).toString();
        return response;
    }

    async setup(options: RtspClientTcpSetupOptions | RtspClientUdpSetupOptions, headers?: Headers) {
        const protocol = options.type === 'udp' ? '' : '/TCP';
        const client = options.type === 'udp' ? 'client_port' : 'interleaved';
        let port: number;
        if (options.type === 'tcp') {
            port = options.port;
        }
        else {
            if (!options.dgram) {
                const udp = await createBindZero();
                options.dgram = udp.server;
                this.client.on('close', () => closeQuiet(udp.server));
            }
            port = options.dgram.address().port;
            options.dgram.on('message', data => options.onRtp(undefined, data));
        }
        headers = Object.assign({
            Transport: `RTP/AVP${protocol};unicast;${client}=${port}-${port + 1}`,
        }, headers);
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
            this.setupOptions.set(interleaved ? interleaved.begin : port, options);
        return Object.assign({ interleaved, options }, response);
    }

    async play(headers: Headers = {}, start = '0.000') {
        headers['Range'] = `npt=${start}-`;
        return this.request('PLAY', headers);
    }

    writePlay(start: string = '0.000') {
        const headers: any = {
            Range: `npt=${start}-`,
        };
        return this.writeRequest('PLAY', headers);
    }

    writeRtpPayload(header: Buffer, rtp: Buffer) {
        this.client.write(header);
        return this.client.write(Buffer.from(rtp));
    }

    send(rtp: Buffer, channel: number) {
        const header = Buffer.alloc(4);
        header.writeUInt8(RTSP_FRAME_MAGIC, 0);
        header.writeUInt8(channel, 1);
        header.writeUInt16BE(rtp.length, 2);

        return this.writeRtpPayload(header, rtp);
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
    rtp?: dgram.Socket;
    rtcp?: dgram.Socket;
}

export class RtspServer {
    session: string;
    console: Console;
    setupTracks: {
        [trackId: string]: RtspTrack;
    } = {};

    constructor(public client: Duplex, public sdp?: string, public udp?: boolean, public checkRequest?: (method: string, url: string, headers: Headers, rawMessage: string[]) => Promise<boolean>) {
        this.session = randomBytes(4).toString('hex');
        if (sdp)
            sdp = sdp.trim();

        if (client instanceof net.Socket)
            client.setNoDelay(true);
    }

    async handleSetup(methods = ['play', 'record', 'teardown']) {
        let currentHeaders: string[] = [];
        while (true) {
            let line = await readLine(this.client);
            line = line.trim();
            if (!line) {
                const method = await this.headers(currentHeaders);
                if (methods.includes(method))
                    return method;
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

    writeRtpPayload(header: Buffer, rtp: Buffer) {
        this.client.write(header);
        return this.client.write(Buffer.from(rtp));
    }

    send(rtp: Buffer, channel: number) {
        const header = Buffer.alloc(4);
        header.writeUInt8(36, 0);
        header.writeUInt8(channel, 1);
        header.writeUInt16BE(rtp.length, 2);

        return this.writeRtpPayload(header, rtp);
    }

    sendUdp(udp: dgram.Socket, port: number, packet: Buffer) {
        // todo: support non local host?
        udp.send(packet, port, '127.0.0.1');
    }

    sendTrack(trackId: string, packet: Buffer, rtcp: boolean) {
        const track = this.setupTracks[trackId];
        if (!track) {
            this.console?.warn('RTSP Server track not found:', trackId);
            return true;
        }

        if (track.protocol === 'udp') {
            if (!this.udp)
                this.console?.warn('RTSP Server UDP socket not available.');
            else
                this.sendUdp(rtcp ? track.rtcp : track.rtp, track.destination, packet);
            return true;
        }

        return this.send(packet, rtcp ? track.destination + 1 : track.destination);
    }

    availableOptions = ['DESCRIBE', 'OPTIONS', 'PAUSE', 'PLAY', 'SETUP', 'TEARDOWN', 'ANNOUNCE', 'RECORD', 'GET_PARAMETER'];
    options(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['Public'] = this.availableOptions.join(', ');

        this.respond(200, 'OK', requestHeaders, headers);
    }

    async get_parameter(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        this.respond(200, 'OK', requestHeaders, headers);
    }

    describe(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        headers['Content-Base'] = url;
        headers['Content-Type'] = 'application/sdp';
        this.respond(200, 'OK', requestHeaders, headers, Buffer.from(this.sdp))
    }

    setupInterleaved(msection: MSection, low: number, high: number) {
        this.setupTracks[msection.control] = {
            control: msection.control,
            protocol: 'tcp',
            destination: low,
            codec: msection.codec,
        }
    }


    resolveInterleaved?: (msection: MSection) => [number, number];

    // todo: use the sdp itself to determine the audio/video track ids so
    // rewriting is not necessary.
    async setup(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        let transport = requestHeaders['transport'];
        headers['Session'] = this.session;
        const parsedSdp = parseSdp(this.sdp);
        const msection = parsedSdp.msections.find(msection => url.endsWith(msection.control));
        if (!msection) {
            this.respond(404, 'Not Found', requestHeaders, headers);
            return;
        }

        if (transport.includes('TCP')) {
            if (this.resolveInterleaved) {
                const [low, high] = this.resolveInterleaved(msection);
                this.setupInterleaved(msection, low, high);
                transport = `RTP/AVP/TCP;unicast;interleaved=${low}-${high}`;
            }
            else {
                const match = transport.match(/.*?interleaved=([0-9]+)-([0-9]+)/);
                if (match) {
                    const low = parseInt(match[1]);
                    const high = parseInt(match[2]);
                    this.setupInterleaved(msection, low, high);
                }
            }
        }
        else {
            if (!this.udp) {
                this.respond(461, 'Unsupported Transport', requestHeaders, {});
                return;
            }
            const match = transport.match(/.*?client_port=([0-9]+)-([0-9]+)/);
            const [_, rtp, rtcp] = match;

            const [rtpServer, rtcpServer] = await createSquentialBindZero();
            this.client.on('close', () => closeQuiet(rtpServer.server));
            this.client.on('close', () => closeQuiet(rtcpServer.server));
            this.setupTracks[msection.control] = {
                control: msection.control,
                protocol: 'udp',
                destination: parseInt(rtp),
                codec: msection.codec,
                rtp: rtpServer.server,
                rtcp: rtcpServer.server,
            }
            transport = transport.replace('RTP/AVP/UDP', 'RTP/AVP').replace('RTP/AVP', 'RTP/AVP/UDP');
            transport += `;server_port=${rtpServer.port}-${rtcpServer.port}`;
        }
        headers['Transport'] = transport;
        this.respond(200, 'OK', requestHeaders, headers)
    }

    play(url: string, requestHeaders: Headers) {
        const headers: Headers = {};
        const rtpInfos = Object.values(this.setupTracks).map(track => `url=${url}/${track.control}`);
        // seq/rtptime was causing issues with gstreamer. commented out.
        const rtpInfo = rtpInfos.join(','); // + ';seq=0;rtptime=0';
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
        this.client.destroy();
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
        if (!thisAny[method] || !this.availableOptions.includes(method.toUpperCase())) {
            this.respond(400, 'Bad Request', requestHeaders, {});
            return;
        }

        await thisAny[method](url, requestHeaders);
        return method;
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

    destroy() {
        this.client.destroy();
        for (const track of Object.values(this.setupTracks)) {
            closeQuiet(track.rtp);
            closeQuiet(track.rtcp);
        }
    }
}

export async function listenSingleRtspClient<T extends RtspServer>(options?: {
    hostname: string,
    pathToken?: string,
    createServer?(duplex: Duplex): T,
}) {
    const pathToken = options?.pathToken || crypto.randomBytes(8).toString('hex');
    let { url, clientPromise, server } = await listenZeroSingleClient(options?.hostname);

    const rtspServerPath = '/' + pathToken;
    url = url.replace('tcp:', 'rtsp:') + rtspServerPath;

    const rtspServerPromise = clientPromise.then(client => {
        const createServer = options?.createServer || (duplex => new RtspServer(duplex));

        const rtspServer = createServer(client);
        rtspServer.checkRequest = async (method, url, headers, message) => {
            rtspServer.checkRequest = undefined;
            const u = new URL(url);
            return u.pathname === rtspServerPath;
        };
        return rtspServer as T;
    });

    return {
        url,
        rtspServerPromise,
        server,
    }
}
