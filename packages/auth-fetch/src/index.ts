import type { IncomingMessage } from "http";
import type { Readable } from "stream";
import { domFetch, domFetchParseIncomingMessage } from "../../../server/src/fetch";
import { httpFetch, httpFetchParseIncomingMessage } from '../../../server/src/fetch/http-fetch';
import { createAuthFetch } from "./auth-fetch";
export { httpFetch } from '../../../server/src/fetch/http-fetch';

function init() {
    try {
        require('net');
        require('events');
        return createAuthFetch<Readable, IncomingMessage>(httpFetch, httpFetchParseIncomingMessage);
    }
    catch (e) {
    }

    return createAuthFetch<BodyInit, Response>(domFetch, domFetchParseIncomingMessage);
}

export const authFetch = init();
