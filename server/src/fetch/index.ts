export type HttpFetchResponseType = 'json' | 'text' | 'buffer' | 'readable';
export interface HttpFetchOptionsBase<B> {
    url: string | URL;
    family?: 4 | 6;
    method?: string;
    headers?: HeadersInit;
    signal?: AbortSignal,
    timeout?: number;
    rejectUnauthorized?: boolean;
    /**
     * Checks the status code. Defaults to true.
     */
    checkStatusCode?: boolean | ((statusCode: number) => boolean);
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
    return true;
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


export function getHttpFetchAccept(responseType: HttpFetchResponseType | undefined) {
    switch (responseType) {
        case 'json':
            return 'application/json';
        case 'text':
            return 'text/plain';
    }
    return;
}

export function hasHeader(headers: [string, string][], key: string) {
    key = key.toLowerCase();
    return headers.find(([k]) => k.toLowerCase() === key);
}

export function removeHeader(headers: [string, string][], key: string) {
    key = key.toLowerCase();
    const filteredHeaders = headers.filter(([headerKey, _]) => headerKey.toLowerCase() !== key);
    headers.length = 0;
    filteredHeaders.forEach(header => headers.push(header));
}

export function setHeader(headers: [string, string][], key: string, value: string) {
    removeHeader(headers, key);
    headers.push([key, value]);
}

export function setDefaultHttpFetchAccept(headers: [string, string][], responseType: HttpFetchResponseType | undefined) {
    if (hasHeader(headers, 'Accept'))
        return;
    const accept = getHttpFetchAccept(responseType);
    if (accept)
        setHeader(headers, 'Accept', accept);
}

export function createHeadersArray(headers: HeadersInit | undefined): [string, string][] {
    const headersArray: [string, string][] = [];
    if (!headers)
        return headersArray;
    if (headers instanceof Headers) {
        for (const [k, v] of headers.entries()) {
            headersArray.push([k, v]);
        }
        return headersArray;
    }

    if (headers instanceof Array) {
        for (const [k, v] of headers) {
            headersArray.push([k, v]);
        }
        return headersArray;
    }

    for (const k of Object.keys(headers)) {
        const v = headers[k];
        headersArray.push([k, v]);
    }

    return headersArray;
}

/**
 *
 * @param headers
 * @param body
 * @returns Returns the body and Content-Type header that was set.
 */
export function createStringOrBufferBody(headers: [string, string][], body: any) {
    let contentType: string | undefined;
    if (typeof body === 'object') {
        body = JSON.stringify(body);
        contentType = 'application/json';
    }
    else if (typeof body === 'string') {
        contentType = 'text/plain';
    }

    if (contentType && !hasHeader(headers, 'Content-Type'))
        setHeader(headers, 'Content-Type', contentType);

    if (!hasHeader(headers, 'Content-Length')) {
        body = Buffer.from(body);
        setHeader(headers, 'Content-Length', body.length.toString());
    }
    return body;
}

export async function domFetchParseIncomingMessage(response: Response, responseType: HttpFetchResponseType | undefined) {
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
    const headers = createHeadersArray(options.headers);
    setDefaultHttpFetchAccept(headers, options.responseType);

    let { body } = options;
    if (body && !(body instanceof ReadableStream)) {
        body = createStringOrBufferBody(headers, body);
    }

    let controller: AbortController | undefined;
    let timeout: NodeJS.Timeout;
    if (options.timeout) {
        controller = new AbortController();
        timeout = setTimeout(() => controller!.abort(), options.timeout);

        options.signal?.addEventListener('abort', () => controller!.abort(options.signal?.reason));
    }

    try {
        const { url } = options;
        const response = await fetch(url, {
            method: getFetchMethod(options),
            credentials: options.withCredentials ? 'include' : undefined,
            headers,
            signal: controller?.signal || options.signal,
            body,
        });

        if (options?.checkStatusCode === undefined || options?.checkStatusCode) {
            try {
                const checker = typeof options?.checkStatusCode === 'function' ? options.checkStatusCode : checkStatus;
                if (!checker(response.status))
                    throw new Error(`http response statusCode ${response.status}`);
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
    finally {
        clearTimeout(timeout!);
    }
}
