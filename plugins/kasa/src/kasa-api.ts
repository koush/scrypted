import { authHttpFetch, AuthFetchCredentialState } from '@scrypted/common/src/http-auth-fetch';
import { readLength } from '@scrypted/common/src/read-stream';
import { once } from 'events';
import type { IncomingMessage } from 'http';
import type { Readable } from 'stream';

// Kasa cameras serve a non-standard mixed multipart stream over HTTPS on this port/path.
// Reverse-engineered: https://medium.com/@hu3vjeen/reverse-engineering-tp-link-kc100-bac4641bf1cd
export const KASA_DEFAULT_PORT = 19443;
export const KASA_STREAM_PATH = '/https/stream/mixed';

// Real headers from this camera fit in well under 1 KB. Cap at 32 KB so a malformed framing
// (or an attacker who substitutes a non-Kasa endpoint) can't grow the queued chunks until
// the stream eventually ends. Throwing here surfaces the problem instead of silently
// retaining memory.
const MAX_HEADER_BYTES = 32 * 1024;

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
    body: Buffer;
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

        // Read the boundary + header block as one buffer (terminated by a blank line) and
        // walk it byte-wise to extract just content-type and content-length. At ~30 parts/s
        // this avoids the regex split and ~6 string allocations per part that a per-line
        // approach would do.
        const headerBlock = await readUntilDoubleCrlf(this.body);
        const len = headerBlock.length;

        // Pull out the next \r\n- or \n-terminated line as a string. Returns the slice plus
        // the index just after the line terminator. Skips leading blank lines so a stray
        // CRLF before the boundary (some firmwares) doesn't break parsing.
        const nextLine = (start: number): { line: string; next: number } => {
            let i = start;
            // Find next LF.
            while (i < len && headerBlock[i] !== 0x0a) i++;
            // Trim a trailing CR if present.
            const end = (i > start && headerBlock[i - 1] === 0x0d) ? i - 1 : i;
            return { line: headerBlock.toString('utf8', start, end), next: i + 1 };
        };

        let pos = 0;
        // Tolerate leading empty lines.
        while (pos < len) {
            const { line, next } = nextLine(pos);
            if (line) {
                if (line !== expected)
                    throw new Error(`unexpected boundary line: ${JSON.stringify(line)}`);
                pos = next;
                break;
            }
            pos = next;
        }

        let contentType = '';
        let length = -1;
        while (pos < len) {
            const { line, next } = nextLine(pos);
            pos = next;
            if (!line)
                break;
            // Header names from this camera are stable (`Content-Type:`, `Content-Length:`),
            // but match case-insensitively to tolerate firmware revisions.
            if (line.length > 13 && line.charCodeAt(12) === 0x3a /* : */) {
                const name = line.slice(0, 12);
                if (name === 'Content-Type' || name.toLowerCase() === 'content-type') {
                    contentType = line.slice(13).trim();
                    continue;
                }
            }
            if (line.length > 15 && line.charCodeAt(14) === 0x3a) {
                const name = line.slice(0, 14);
                if (name === 'Content-Length' || name.toLowerCase() === 'content-length') {
                    const n = parseInt(line.slice(15).trim(), 10);
                    if (Number.isFinite(n) && n >= 0)
                        length = n;
                    continue;
                }
            }
        }

        if (length < 0)
            throw new Error('multipart: no/invalid content length');

        const body = length === 0 ? Buffer.alloc(0) : await readLength(this.body, length);
        return { contentType, body };
    }
}

// Read up to and including the first blank line (CRLF CRLF or LF LF) and return everything
// up to and including the terminator as a Buffer. Whatever bytes come after are unshifted
// back so the body that follows can be read intact. Enforces MAX_HEADER_BYTES so a malformed
// stream that never sends a terminator can't grow queued chunks unbounded.
async function readUntilDoubleCrlf(readable: Readable): Promise<Buffer> {
    const queued: Buffer[] = [];
    let queuedLen = 0;
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
            queuedLen += chunk.length;
            if (queuedLen > MAX_HEADER_BYTES)
                throw new Error(`multipart header exceeded ${MAX_HEADER_BYTES} bytes without terminator`);
            queued.push(chunk);
            continue;
        }
        const headerPart = chunk.subarray(0, split);
        const rest = chunk.subarray(split);
        if (queuedLen + headerPart.length > MAX_HEADER_BYTES)
            throw new Error(`multipart header exceeded ${MAX_HEADER_BYTES} bytes`);
        queued.push(headerPart);
        if (rest.length)
            readable.unshift(rest);
        return queued.length === 1 ? queued[0] : Buffer.concat(queued);
    }
}
