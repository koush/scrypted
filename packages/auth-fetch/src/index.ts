import { createAuthFetch } from "./auth-fetch";
import { httpFetch, httpFetchParseIncomingMessage } from '../../../server/src/fetch/http-fetch';
import type { Readable } from "stream";
import type { IncomingMessage } from "http";
import { domFetch, domFetchParseIncomingMessage } from "../../../server/src/fetch";

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
