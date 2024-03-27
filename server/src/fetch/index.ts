
export type HttpFetchResponseType = 'json' | 'text' | 'buffer' | 'readable';
export interface HttpFetchOptionsBase<B> {
    url: string | URL;
    family?: 4 | 6;
    method?: string;
    headers?: HeadersInit;
    signal?: AbortSignal,
    timeout?: number;
    rejectUnauthorized?: boolean;
    ignoreStatusCode?: boolean;
    body?: B | string | ArrayBufferView | any;
    withCredentials?: boolean;
}

export interface HttpFetchJsonOptions<B> extends HttpFetchOptionsBase<B> {
    responseType: 'json';
}

export interface HttpFetchBufferOptions<B> extends HttpFetchOptionsBase<B> {
    responseType: 'buffer';
}

export interface HttpFetchDefaultOptions<B> extends HttpFetchOptionsBase<B> {
    responseType?: undefined;
}

export interface HttpFetchTextOptions<B> extends HttpFetchOptionsBase<B> {
    responseType: 'text';
}
export interface HttpFetchReadableOptions<B> extends HttpFetchOptionsBase<B> {
    responseType: 'readable';
}

export type HttpFetchOptions<B> = HttpFetchJsonOptions<B> | HttpFetchBufferOptions<B> | HttpFetchDefaultOptions<B> | HttpFetchTextOptions<B> | HttpFetchReadableOptions<B>;

export function fetchStatusCodeOk(statusCode: number) {
    return statusCode >= 200 && statusCode <= 299;
}

export function checkStatus(statusCode: number) {
    if (!fetchStatusCodeOk(statusCode))
        throw new Error(`http response statusCode ${statusCode}`);
}

export function getFetchMethod(options: HttpFetchOptions<any>) {
    const method = options.method || (options.body ? 'POST' : 'GET');
    return method;
}

export interface HttpFetchResponse<T> {
    statusCode: number;
    headers: Headers;
    body: T;
}

export type fetcher<B, M> = <T extends HttpFetchOptions<B>>(options: T) => Promise<HttpFetchResponse<
    // first one serves as default.
    T extends HttpFetchBufferOptions<B> ? Buffer
    : T extends HttpFetchTextOptions<B> ? string
    : T extends HttpFetchReadableOptions<B> ? M
    : T extends HttpFetchJsonOptions<B> ? any : Buffer
>>;


export function getHttpFetchAccept(responseType: HttpFetchResponseType) {
    switch (responseType) {
        case 'json':
            return 'application/json';
        case 'text':
            return 'text/plain';
    }
    return;
}

export function setDefaultHttpFetchAccept(headers: Headers, responseType: HttpFetchResponseType) {
    if (headers.has('Accept'))
        return;
    const accept = getHttpFetchAccept(responseType);
    if (accept)
        headers.set('Accept', accept);
}

export function createStringOrBufferBody(headers: Headers, body: any) {
    let contentType: string;
    if (typeof body === 'object') {
        body = JSON.stringify(body);
        contentType = 'application/json';
    }
    else if (typeof body === 'string') {
        contentType = 'text/plain';
    }

    if (!headers.has('Content-Type'))
        headers.set('Content-Type', contentType);

    return body;
}

export async function domFetchParseIncomingMessage(response: Response, responseType: HttpFetchResponseType) {
    switch (responseType) {
        case 'json':
            return response.json();
        case 'text':
            return response.text();
        case 'readable':
            return response;
    }
    return new Uint8Array(await response.arrayBuffer());
}

export async function domFetch<T extends HttpFetchOptions<BodyInit>>(options: T): Promise<HttpFetchResponse<
    // first one serves as default.
    T extends HttpFetchBufferOptions<BodyInit> ? Buffer
    : T extends HttpFetchTextOptions<BodyInit> ? string
    : T extends HttpFetchReadableOptions<BodyInit> ? Response
    : T extends HttpFetchJsonOptions<BodyInit> ? any : Buffer
>> {
    const headers = new Headers(options.headers);
    setDefaultHttpFetchAccept(headers, options.responseType);

    let { body } = options;
    if (body && !(body instanceof ReadableStream)) {
        body = createStringOrBufferBody(headers, body);
    }

    const { url } = options;
    const response = await fetch(url, {
        method: getFetchMethod(options),
        credentials: options.withCredentials ? 'include' : undefined,
        headers,
        signal: options.signal || options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
        body,
    });

    if (!options?.ignoreStatusCode) {
        try {
            checkStatus(response.status);
        }
        catch (e) {
            response.arrayBuffer().catch(() => { });
            throw e;
        }
    }

    return {
        statusCode: response.status,
        headers: response.headers,
        body: await domFetchParseIncomingMessage(response, options.responseType),
    };
}

function ensureType<T>(v: T) {
}

async function test() {
    const a = await domFetch({
        url: 'http://example.com',
    });

    ensureType<Buffer>(a.body);

    const b = await domFetch({
        url: 'http://example.com',
        responseType: 'json',
    });
    ensureType<any>(b.body);

    const c = await domFetch({
        url: 'http://example.com',
        responseType: 'readable',
    });
    ensureType<Response>(c.body);

    const d = await domFetch({
        url: 'http://example.com',
        responseType: 'buffer',
    });
    ensureType<Buffer>(d.body);
}
