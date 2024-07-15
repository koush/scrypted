import { HttpFetchOptions, HttpFetchResponseType, checkStatus, createHeadersArray, fetcher, getFetchMethod, hasHeader, setDefaultHttpFetchAccept, setHeader } from '../../../server/src/fetch';

export interface AuthFetchCredentialState {
    username: string;
    password: string;
}

export interface AuthFetchOptions {
    credential?: AuthFetchCredentialState;
}

async function getAuth(options: AuthFetchOptions, url: string | URL, method: string) {
    if (!options.credential)
        return;

    const { BASIC, DIGEST, parseWWWAuthenticateHeader } = await import('http-auth-utils');

    const credential = options.credential as AuthFetchCredentialState & {
        count?: number;
        digest?: ReturnType<typeof parseWWWAuthenticateHeader<typeof DIGEST>>;
        basic?: ReturnType<typeof parseWWWAuthenticateHeader<typeof BASIC>>;
    };
    const { digest, basic } = credential;

    if (digest) {
        credential.count ||= 0;
        ++credential.count;
        const nc = ('00000000' + credential.count).slice(-8);
        const cnonce = [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
        const uri = new URL(url).pathname;

        const { DIGEST, buildAuthorizationHeader } = await import('http-auth-utils');

        const response = DIGEST.computeHash({
            username: options.credential.username,
            password: options.credential.password,
            method,
            uri,
            nc,
            cnonce,
            algorithm: 'MD5',
            qop: digest.data.qop!,
            ...digest.data,
        });

        const header = buildAuthorizationHeader(DIGEST, {
            username: options.credential.username,
            uri,
            nc,
            cnonce,
            algorithm: digest.data.algorithm!,
            qop: digest.data.qop!,
            response,
            ...digest.data,
        });

        return header;
    }
    else if (basic) {
        const { BASIC, buildAuthorizationHeader } = await import('http-auth-utils');

        const header = buildAuthorizationHeader(BASIC, {
            username: options.credential.username,
            password: options.credential.password,
        });

        return header;
    }
}

export function createAuthFetch<B, M>(
    h: fetcher<B, M>,
    parser: (body: M, responseType: HttpFetchResponseType | undefined) => Promise<any>
) {
    const authHttpFetch = async <T extends HttpFetchOptions<B>>(options: T & AuthFetchOptions): ReturnType<typeof h<T>> => {
        const method = getFetchMethod(options);
        const headers = createHeadersArray(options.headers);
        options.headers = headers;
        setDefaultHttpFetchAccept(headers, options.responseType);

        const initialHeader = await getAuth(options, options.url, method);
        // try to provide an authorization if a session exists, but don't override Authorization if provided already.
        // 401 will trigger a proper auth.
        if (initialHeader && !hasHeader(headers, 'Authorization'))
            setHeader(headers, 'Authorization', initialHeader);


        const controller = new AbortController();
        options.signal?.addEventListener('abort', () => controller.abort(options.signal?.reason));

        const initialResponse = await h({
            ...options,
            signal: controller.signal,
            // need to intercept the status code to check for 401.
            // all other status codes will be handled according to the initial request options.
            checkStatusCode(statusCode) {
                // can handle a 401 if an credential is provided.
                // however, not providing a credential is also valid, and should
                // fall through to the normal response handling which may be interested
                // in the 401 response.
                if (statusCode === 401 && options.credential)
                    return true;
                if (options?.checkStatusCode === undefined || options?.checkStatusCode) {
                    const checker = typeof options?.checkStatusCode === 'function' ? options.checkStatusCode : checkStatus;
                    return checker(statusCode);
                }
                return true;
            },
            responseType: 'readable',
        });

        // if it's not a 401, just return the response.
        if (initialResponse.statusCode !== 401) {
            return {
                ...initialResponse,
                body: await parser(initialResponse.body, options.responseType),
            };
        }

        let authenticateHeaders: string | string[] | null = initialResponse.headers.get('www-authenticate');
        if (!authenticateHeaders)
            throw new Error('Did not find WWW-Authenticate header.');


        if (typeof authenticateHeaders === 'string')
            authenticateHeaders = [authenticateHeaders];

        const { BASIC, DIGEST, parseWWWAuthenticateHeader } = await import('http-auth-utils');
        const parsedHeaders = authenticateHeaders.map(h => parseWWWAuthenticateHeader(h));

        const digest = parsedHeaders.find(p => p.type === 'Digest') as ReturnType<typeof parseWWWAuthenticateHeader<typeof DIGEST>>;
        const basic = parsedHeaders.find(p => p.type === 'Basic') as ReturnType<typeof parseWWWAuthenticateHeader<typeof BASIC>>;
        const credential = options.credential as AuthFetchCredentialState & {
            count?: number;
            digest?: ReturnType<typeof parseWWWAuthenticateHeader<typeof DIGEST>>;
            basic?: ReturnType<typeof parseWWWAuthenticateHeader<typeof BASIC>>;
        };

        credential.digest = digest;
        credential.basic = basic;

        if (!digest && !basic)
            throw new Error(`Unknown WWW-Authenticate type: ${parsedHeaders[0]?.type}`);

        const header = await getAuth(options, options.url, method);
        if (header)
            setHeader(headers, 'Authorization', header);

        return h(options);
    }

    return authHttpFetch;
}
