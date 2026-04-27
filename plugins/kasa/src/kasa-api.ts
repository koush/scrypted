import { authHttpFetch, AuthFetchCredentialState } from '@scrypted/common/src/http-auth-fetch';
import { readLength } from '@scrypted/common/src/read-stream';
import { once } from 'events';
import type { IncomingMessage } from 'http';
import type { Readable } from 'stream';

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

        // Read the boundary + header block as one chunk (terminated by a blank line) instead
        // of using readLine per-line. At ~30 video parts/sec + audio, every readLine call is a
        // separate await with its own microtask hop and unshift; bulk parsing trims that.
        const headerBlock = await readUntilDoubleCrlf(this.body);
        const lines = headerBlock.split(/\r?\n/);

        let lineIdx = 0;
        // Tolerate leading empty lines (some firmwares emit a stray CRLF before the boundary).
        while (lineIdx < lines.length && !lines[lineIdx])
            lineIdx++;
        if (lineIdx >= lines.length || lines[lineIdx] !== expected)
            throw new Error(`unexpected boundary line: ${JSON.stringify(lines[lineIdx] ?? '')}`);
        lineIdx++;

        const headers: Record<string, string> = {};
        for (; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
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

// Read up to and including the first blank line (CRLF CRLF or LF LF) and return everything
// up to and including the terminator as a UTF-8 string. Whatever bytes come after are
// unshifted back so the body that follows can be read intact. Uses a small state machine so
// the terminator is detected correctly even when it straddles multiple read chunks.
async function readUntilDoubleCrlf(readable: Readable): Promise<string> {
    const queued: Buffer[] = [];
    // crlf encodes how many bytes of \r\n\r\n we've matched: 0,1=\r, 2=\r\n, 3=\r\n\r, 4=done.
    // lfOnly counts consecutive \n bytes (some firmwares emit LF-only framing).
    let crlf = 0;
    let lfOnly = 0;
    while (true) {
        if (readable.readableEnded || readable.destroyed)
            throw new Error('kasa stream ended before headers');
        const chunk: Buffer | null = readable.read();
        if (!chunk) {
            // Race 'readable' against 'end'/'close'/'error': if the stream has already ended
            // (or terminates while we're waiting), 'readable' will never fire and the await
            // would strand this promise forever. Re-checking readableEnded on the next loop
            // turn lets us throw a real error instead of hanging.
            //
            // AbortController removes the losing once() listeners; without it each iteration
            // would leave 2 dangling listeners attached for the lifetime of the stream and
            // eventually trip MaxListenersExceededWarning on a long stream with many parts.
            const ac = new AbortController();
            try {
                await Promise.race([
                    once(readable, 'readable', { signal: ac.signal }).catch(() => { /* aborted or end */ }),
                    once(readable, 'end', { signal: ac.signal }).catch(() => { }),
                    once(readable, 'close', { signal: ac.signal }).catch(() => { }),
                ]);
            }
            finally {
                ac.abort();
            }
            continue;
        }
        let split = -1;
        for (let i = 0; i < chunk.length; i++) {
            const b = chunk[i];
            if (crlf === 0 && b === 0x0d) crlf = 1;
            else if (crlf === 1 && b === 0x0a) crlf = 2;
            else if (crlf === 2 && b === 0x0d) crlf = 3;
            else if (crlf === 3 && b === 0x0a) { split = i + 1; break; }
            else crlf = b === 0x0d ? 1 : 0;
            if (b === 0x0a) {
                if (++lfOnly === 2) { split = i + 1; break; }
            } else lfOnly = 0;
        }
        if (split < 0) {
            queued.push(chunk);
            continue;
        }
        const headerPart = chunk.subarray(0, split);
        const rest = chunk.subarray(split);
        queued.push(headerPart);
        if (rest.length)
            readable.unshift(rest);
        return Buffer.concat(queued).toString('utf8');
    }
}
