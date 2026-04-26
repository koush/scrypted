import { authHttpFetch, AuthFetchCredentialState } from '@scrypted/common/src/http-auth-fetch';
import { readLength, readLine } from '@scrypted/common/src/read-stream';
import type { IncomingMessage } from 'http';

// Kasa cameras serve a non-standard mixed multipart stream over HTTPS on this port/path.
// Reverse-engineered: https://medium.com/@hu3vjeen/reverse-engineering-tp-link-kc100-bac4641bf1cd
export const KASA_DEFAULT_PORT = 19443;
export const KASA_STREAM_PATH = '/https/stream/mixed';

export const KasaMimeVideo = 'video/x-h264';
export const KasaMimeG711U = 'audio/g711u';

const H264_NAL_TYPE_SPS = 7;
const H264_NAL_TYPE_PPS = 8;

export interface H264SpsPps {
    sps?: Buffer;
    pps?: Buffer;
}

// Scans an annex-b H.264 buffer (NALs prefixed by 00 00 01 or 00 00 00 01) for SPS (type 7)
// and PPS (type 8). Mutates `found` so callers can accumulate across multiple parts; once both
// are set further calls are cheap and idempotent.
export function findSpsPps(annexb: Buffer, found: H264SpsPps = {}): H264SpsPps {
    const len = annexb.length;
    let i = 0;
    while (i < len) {
        let nalStart = -1;
        if (i + 2 < len && annexb[i] === 0 && annexb[i + 1] === 0) {
            if (annexb[i + 2] === 1)
                nalStart = i + 3;
            else if (i + 3 < len && annexb[i + 2] === 0 && annexb[i + 3] === 1)
                nalStart = i + 4;
        }
        if (nalStart < 0) {
            i++;
            continue;
        }
        // Walk forward to the next start code; if none, the NAL runs to end-of-buffer.
        let nalEnd = len;
        for (let j = nalStart + 1; j + 2 < len; j++) {
            if (annexb[j] === 0 && annexb[j + 1] === 0
                && (annexb[j + 2] === 1
                    || (j + 3 < len && annexb[j + 2] === 0 && annexb[j + 3] === 1))) {
                nalEnd = j;
                break;
            }
        }
        const nalType = annexb[nalStart] & 0x1f;
        if (nalType === H264_NAL_TYPE_SPS && !found.sps)
            found.sps = annexb.subarray(nalStart, nalEnd);
        else if (nalType === H264_NAL_TYPE_PPS && !found.pps)
            found.pps = annexb.subarray(nalStart, nalEnd);
        i = nalEnd;
    }
    return found;
}

export interface KasaConnectOptions {
    ip: string;
    port?: number;
    username: string;
    password: string;
}

export interface KasaPart {
    contentType: string;
    headers: Record<string, string>;
    body: Buffer;
    timestampSeconds?: number;
}

// Camera quirk: the Basic auth password must itself be base64(plaintext) before the standard
// Basic auth base64(user:pass) wrapping. Username is the plaintext Kasa account email.
function encodeKasaPassword(plaintext: string) {
    return Buffer.from(plaintext, 'utf8').toString('base64');
}

export class KasaClient {
    body!: IncomingMessage;
    boundary!: string;

    static async connect(options: KasaConnectOptions): Promise<KasaClient> {
        const port = options.port || KASA_DEFAULT_PORT;
        const username = options.username;
        const password = encodeKasaPassword(options.password);

        const url = `https://${options.ip}:${port}${KASA_STREAM_PATH}`;

        const credential: AuthFetchCredentialState = {
            username,
            password,
        };

        // Cameras present a self-signed cert. responseType: 'readable' is required so the body
        // stays open as a long-lived stream rather than being buffered to completion.
        const response = await authHttpFetch({
            url,
            credential,
            responseType: 'readable',
            rejectUnauthorized: false,
        });

        const contentType = response.headers.get('content-type') || '';
        if (!/multipart\/x-mixed-replace/i.test(contentType))
            throw new Error(`unexpected content-type: ${contentType}`);

        const m = /boundary=([^;\s]+)/i.exec(contentType);
        if (!m)
            throw new Error(`missing boundary in content-type: ${contentType}`);

        const client = new KasaClient();
        client.body = response.body;
        client.boundary = m[1];
        return client;
    }

    destroy() {
        this.body?.destroy();
    }

    async readPart(): Promise<KasaPart> {
        const expected = '--' + this.boundary;

        // readLine returns up-to-but-not-including '\n'; strip a possible trailing '\r' to
        // tolerate both CRLF (HTTP standard) and LF-only framing some firmwares emit.
        while (true) {
            const line = (await readLine(this.body)).replace(/\r$/, '');
            if (!line)
                continue;
            if (line !== expected)
                throw new Error(`unexpected boundary line: ${JSON.stringify(line)}`);
            break;
        }

        const headers: Record<string, string> = {};
        while (true) {
            const line = (await readLine(this.body)).replace(/\r$/, '');
            if (!line)
                break;
            const idx = line.indexOf(':');
            if (idx < 0)
                continue;
            const key = line.slice(0, idx).trim().toLowerCase();
            const value = line.slice(idx + 1).trim();
            headers[key] = value;
        }

        const lengthRaw = headers['content-length'];
        if (!lengthRaw)
            throw new Error('multipart: no content length');
        const length = parseInt(lengthRaw, 10);
        if (!Number.isFinite(length) || length < 0)
            throw new Error(`multipart: invalid content length: ${lengthRaw}`);

        const body = length === 0 ? Buffer.alloc(0) : await readLength(this.body, length);

        const contentType = headers['content-type'] || '';
        const ts = headers['x-timestamp'];
        const timestampSeconds = ts ? parseFloat(ts) : undefined;

        return {
            contentType,
            headers,
            body,
            timestampSeconds: Number.isFinite(timestampSeconds!) ? timestampSeconds : undefined,
        };
    }
}
