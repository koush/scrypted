import { httpFetch, httpFetchParseIncomingMessage } from '../../server/src/fetch/http-fetch';
import type { IncomingMessage } from 'http';
import type { Readable } from 'stream';
import { createAuthFetch } from '../../packages/auth-fetch/src/auth-fetch';

export type { HttpFetchOptions, HttpFetchResponseType } from '../../server/src/fetch/http-fetch';
export type { AuthFetchCredentialState, AuthFetchOptions } from '../../packages/auth-fetch/src/auth-fetch';

export const authHttpFetch = createAuthFetch<Readable, IncomingMessage>(httpFetch, httpFetchParseIncomingMessage);

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

    const e = await authHttpFetch({
        credential: undefined,
        url: 'http://example.com',
        responseType: 'text',
    });
    ensureType<string>(e.body);
}

