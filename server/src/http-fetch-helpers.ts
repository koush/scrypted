import { once } from 'events';
import { http, https } from 'follow-redirects';
import { RequestOptions, IncomingMessage, Agent as HttpAgent, IncomingHttpHeaders } from 'http';
import { Agent as HttpsAgent } from 'https';
import { Readable, PassThrough } from 'stream';

export interface HttpFetchOptions {
    url: string;
    ignoreStatusCode?: boolean;
    httpAgent?: HttpAgent,
    httpsAgent?: HttpsAgent;
    body?: Readable;
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

export const TextParser: FetchParser<string> = {
    accept: 'text/plain',
    async parse(message: IncomingMessage) {
        return (await readMessageBuffer(message)).toString();
    }
}
export const JSONParser: FetchParser<any> = {
    accept: 'application/json',
    async parse(message: IncomingMessage) {
        return JSON.parse((await readMessageBuffer(message)).toString());
    }
}

export const BufferParser: FetchParser<Buffer> = {
    accept: undefined as string,
    async parse(message: IncomingMessage) {
        return readMessageBuffer(message);
    }
}

export const StreamParser: FetchParser<IncomingMessage> = {
    accept: undefined as string,
    async parse(message: IncomingMessage) {
        return message;
    }
}

export async function getNpmPackageInfo(pkg: string) {
    const { body } = await httpFetch({ url: `https://registry.npmjs.org/${pkg}` }, {
        // force ipv4 in case of busted ipv6.
        family: 4,
    });
    return body;
}

export function setFetchAcceptOptions(accept: string, init?: RequestOptions) {
    init ||= {};
    init.headers = {
        ...init.headers,
        Accept: accept,
    };
    return init;
}

export async function httpPostFetch(options: HttpFetchOptions, postBody: any, init?: RequestOptions, parser = JSONParser) {
    init ||= {};
    init.method = 'POST';
    init.headers = {
        ...init.headers,
        'Content-Type': 'application/json',
    };

    const pt = new PassThrough();
    pt.write(Buffer.from(JSON.stringify(postBody)));
    pt.end();
    options.body = pt;

    const { body, headers, statusCode } = await httpFetch(options, init, parser);
    return {
        statusCode,
        json: JSON.parse(body.toString()),
        headers,
    }
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
    headers: IncomingHttpHeaders;
    body: T;
}

export async function httpFetch<T = any>(options: HttpFetchOptions, init?: RequestOptions, parser: FetchParser<T> = JSONParser): Promise<HttpFetchResponse<T>> {
    if (parser.accept)
        init = setFetchAcceptOptions(parser.accept, init);

    const { url } = options;
    const isSecure = url.startsWith('https:');
    const proto = isSecure ? https : http;

    const request = proto.request(url, {
        ...init,
        agents: {
            http: options?.httpAgent,
            https: options?.httpsAgent,
        }
    });
    if (options.body)
        options.body.pipe(request);
    else
        request.end();
    const [response] = await once(request, 'response') as IncomingMessage[];

    if (!options?.ignoreStatusCode) {
        try {
            checkStatus(response.statusCode);
        }
        catch (e) {
            readMessageBuffer(response).catch(() => { });
            throw e;
        }
    }

    return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: await parser.parse(response),
    };
}
