import { once } from 'events';
import { http, https } from 'follow-redirects';
import { IncomingMessage } from 'http';
import type { Readable } from 'stream';

export type HttpFetchResponseType = 'json' | 'text' | 'buffer' | 'readable';
export interface HttpFetchOptions<T extends HttpFetchResponseType> {
    url: string | URL;
    family?: 4 | 6;
    method?: string;
    headers?: HeadersInit;
    timeout?: number;
    rejectUnauthorized?: boolean;
    ignoreStatusCode?: boolean;
    body?: Readable;
    responseType?: T;
}

export interface HttpFetchJsonOptions extends HttpFetchOptions<'json'> {
}

export interface HttpFetchBufferOptions extends HttpFetchOptions<'buffer'> {
}

export interface HttpFetchTextOptions extends HttpFetchOptions<'text'> {
}
export interface HttpFetchReadableOptions extends HttpFetchOptions<'readable'> {
}

async function readMessageBuffer(response: IncomingMessage) {
    const buffers: Buffer[] = [];
    response.on('data', buffer => buffers.push(buffer));
    await once(response, 'end');
    return Buffer.concat(buffers);
}

export interface FetchParser<T> {
    accept: string;
    parse(message: IncomingMessage): Promise<T>;
}

const TextParser: FetchParser<string> = {
    accept: 'text/plain',
    async parse(message: IncomingMessage) {
        return (await readMessageBuffer(message)).toString();
    }
}
const JSONParser: FetchParser<any> = {
    accept: 'application/json',
    async parse(message: IncomingMessage) {
        return JSON.parse((await readMessageBuffer(message)).toString());
    }
}

const BufferParser: FetchParser<Buffer> = {
    accept: undefined as string,
    async parse(message: IncomingMessage) {
        return readMessageBuffer(message);
    }
}

const StreamParser: FetchParser<IncomingMessage> = {
    accept: undefined as string,
    async parse(message: IncomingMessage) {
        return message;
    }
}

export async function getNpmPackageInfo(pkg: string) {
    const { body } = await httpFetch({
        url: `https://registry.npmjs.org/${pkg}`,
        // force ipv4 in case of busted ipv6.
        family: 4,
        responseType: 'json',
    });
    return body;
}

export function getHttpFetchAccept(responseType: HttpFetchResponseType) {
    const { accept } = getHttpFetchParser(responseType);
    return accept;
}

export function setDefaultHttpFetchAccept(headers: Headers, responseType: HttpFetchResponseType) {
    if (headers.has('Accept'))
        return;
    const { accept } = getHttpFetchParser(responseType);
    if (accept)
        headers.set('Accept', accept);
}

export function fetchStatusCodeOk(statusCode: number) {
    return statusCode >= 200 && statusCode <= 299;
}

export function checkStatus(statusCode: number) {
    if (!fetchStatusCodeOk(statusCode))
        throw new Error(`http response statusCode ${statusCode}`);
}

export interface HttpFetchResponse<T> {
    statusCode: number;
    headers: Headers;
    body: T;
}

export function getHttpFetchParser(responseType: HttpFetchResponseType) {
    switch (responseType) {
        case 'json':
            return JSONParser;
        case 'text':
            return TextParser;
        case 'readable':
            return StreamParser;
    }
    return BufferParser;
}

export function parseResponseType(readable: IncomingMessage, responseType: HttpFetchResponseType) {
    return getHttpFetchParser(responseType).parse(readable);
}

export async function httpFetch<T extends HttpFetchOptions<HttpFetchResponseType>>(options: T): Promise<HttpFetchResponse<
    // first one serves as default.
    T extends HttpFetchBufferOptions ? Buffer
    : T extends HttpFetchTextOptions ? string
    : T extends HttpFetchReadableOptions ? IncomingMessage
    : T extends HttpFetchJsonOptions ? any : Buffer
>> {
    const headers = new Headers(options.headers);
    setDefaultHttpFetchAccept(headers, options.responseType);

    const parser = getHttpFetchParser(options.responseType);

    const { url } = options;
    const isSecure = url.toString().startsWith('https:');
    const proto = isSecure ? https : http;

    const nodeHeaders: Record<string, string[]> = {};
    for (const [k, v] of headers) {
        if (nodeHeaders[k]) {
            nodeHeaders[k].push(v);
        }
        else {
            nodeHeaders[k] = [v];
        }
    }

    const request = proto.request(url, {
        method: options.method,
        rejectUnauthorized: options.rejectUnauthorized,
        family: options.family,
        headers: nodeHeaders,
        timeout: options.timeout,
    });
    if (options.body)
        options.body.pipe(request);
    else
        request.end();
    const [response] = await once(request, 'response') as [IncomingMessage];

    if (!options?.ignoreStatusCode) {
        try {
            checkStatus(response.statusCode);
        }
        catch (e) {
            readMessageBuffer(response).catch(() => { });
            throw e;
        }
    }

    const incomingHeaders = new Headers();
    for (const [k, v] of Object.entries(response.headers)) {
        for (const vv of (typeof v === 'string' ? [v] : v)) {
            incomingHeaders.append(k, vv)
        }
    }

    return {
        statusCode: response.statusCode,
        headers: incomingHeaders,
        body: await parser.parse(response),
    };
}

function ensureType<T>(v: T) {
}

async function test() {
    const a = await httpFetch({
        url: 'http://example.com',
    });

    ensureType<Buffer>(a.body);

    const b = await httpFetch({
        url: 'http://example.com',
        responseType: 'json',
    });
    ensureType<any>(b.body);

    const c = await httpFetch({
        url: 'http://example.com',
        responseType: 'readable',
    });
    ensureType<IncomingMessage>(c.body);

    const d = await httpFetch({
        url: 'http://example.com',
        responseType: 'buffer',
    });
    ensureType<Buffer>(d.body);
}
