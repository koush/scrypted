import { HttpFetchOptions, HttpFetchResponseType, checkStatus, getHttpFetchParser, httpFetch } from '@scrypted/server/src/http-fetch-helpers';
import crypto from 'crypto';
import { IncomingMessage } from 'http';
import { BASIC, DIGEST, buildAuthorizationHeader, parseWWWAuthenticateHeader } from 'http-auth-utils/src/index';

export interface AuthFetchCredentialState {
    username: string;
    password: string;
    count?: number;
    digest?: ReturnType<typeof parseWWWAuthenticateHeader<typeof DIGEST>>;
    basic?: ReturnType<typeof parseWWWAuthenticateHeader<typeof BASIC>>;
}

export interface AuthFetchOptions<T extends HttpFetchResponseType> extends HttpFetchOptions<T> {
    credential: AuthFetchCredentialState;
}

function getAuth(options: AuthFetchOptions<any>, method: string) {
    if (!options.credential)
        return;
    const { digest, basic } = options.credential;
    if (digest) {
        options.credential.count ||= 0;
        ++options.credential.count;
        const nc = ('00000000' + options.credential.count).slice(-8);
        const cnonce = crypto.randomBytes(24).toString('hex');
        const uri = new URL(options.url).pathname;

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
        const header = buildAuthorizationHeader(BASIC, {
            username: options.credential.username,
            password: options.credential.password,
        });

        return header;
    }
}

export async function authHttpFetch<T extends HttpFetchResponseType>(options: AuthFetchOptions<T>): ReturnType<typeof httpFetch<AuthFetchOptions<T>>> {
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);
    options.headers = headers;

    const initialHeader = getAuth(options, method);
    if (initialHeader)
        headers.set('Authorization', initialHeader);

    const initialResponse = await httpFetch({
        ...options,
        ignoreStatusCode: true,
        responseType: 'readable',
    });

    const parser = getHttpFetchParser(options.responseType);

    if (initialResponse.statusCode !== 401 || !options.credential) {
        if (!options?.ignoreStatusCode)
            checkStatus(initialResponse.statusCode);
        return {
            ...initialResponse,
            body: await parser.parse(initialResponse.body),
        };
    }

    let authenticateHeaders: string | string[] = initialResponse.headers['www-authenticate'];
    if (!authenticateHeaders)
        throw new Error('Did not find WWW-Authenticate header.');


    if (typeof authenticateHeaders === 'string')
        authenticateHeaders = [authenticateHeaders];

    const parsedHeaders = authenticateHeaders.map(h => parseWWWAuthenticateHeader(h));

    const digest = parsedHeaders.find(p => p.type === 'Digest') as ReturnType<typeof parseWWWAuthenticateHeader<typeof DIGEST>>;
    const basic = parsedHeaders.find(p => p.type === 'Basic') as ReturnType<typeof parseWWWAuthenticateHeader<typeof BASIC>>;

    options.credential.digest = digest;
    options.credential.basic = basic;

    if (!digest && !basic)
        throw new Error(`Unknown WWW-Authenticate type: ${parsedHeaders[0]?.type}`);

    const header = getAuth(options, method);
    if (header)
        headers.set('Authorization', header);

    return httpFetch(options);
}

function ensureType<T>(v: T) {
}

async function test() {
    const a = await authHttpFetch({
        credential: undefined,
        url: 'http://example.com',
    });

    ensureType<Buffer>(a.body);

    const b = await authHttpFetch({
        credential: undefined,
        url: 'http://example.com',
        responseType: 'json',
    });
    ensureType<any>(b.body);

    const c = await authHttpFetch({
        credential: undefined,
        url: 'http://example.com',
        responseType: 'readable',
    });
    ensureType<IncomingMessage>(c.body);

    const d = await authHttpFetch({
        credential: undefined,
        url: 'http://example.com',
        responseType: 'buffer',
    });
    ensureType<Buffer>(d.body);
}

