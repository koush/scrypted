import crypto from 'crypto';
import { ClientRequest } from 'http';
import https from 'https';
import { PassThrough } from 'stream';

export const KASA_TALK_PORT = 18443;
const KASA_TALK_PATH = '/https/speaker/audio/g711block';
const TALK_BOUNDARY = 'audio-boundary--';

// Talk-channel auth uses md5(plaintext) as the password rather than the base64(plaintext)
// the receive stream uses. Same camera, different scheme — observed on KC420WS firmware
// 2.3.26 via mitmproxy capture of the official Kasa iOS app.
function md5Hex(plaintext: string): string {
    return crypto.createHash('md5').update(plaintext, 'utf8').digest('hex');
}

// The Kasa app sends X-APP-ID/playerId of the form "tty.<32 base64-ish chars>". The token
// looks app-generated (not negotiated with the camera), so we mint our own per-session.
function generatePlayerId(): string {
    return 'tty.' + crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '').slice(0, 32);
}

export interface KasaTalkOptions {
    ip: string;
    port?: number;
    username: string;
    password: string;
    console?: Console;
}

// One ongoing POST per talk session. Multipart parts wrap raw G.711 µ-law audio blocks
// (Content-Type: audio/g711u) interleaved with empty audio/heartbeat parts that the app
// uses to keep the connection alive during silence (~one every 3 s). The body is chunked
// transfer encoded; the request never completes until the session is closed.
export class KasaTalkSession {
    private request?: ClientRequest;
    private body = new PassThrough();
    private playerId = '';
    private heartbeatTimer?: NodeJS.Timeout;
    private closed = false;
    private closeCallbacks?: (() => void)[] = [];
    // Resolves once the session is torn down (by the caller, by the camera ending the
    // response, or by an error). Lets the camera's startIntercom await teardown to clean
    // up its ffmpeg process when the uplink dies on its own.
    readonly closedPromise: Promise<void>;
    private resolveClosed!: () => void;

    constructor(public options: KasaTalkOptions) {
        this.closedPromise = new Promise<void>(resolve => { this.resolveClosed = resolve; });
    }

    async start(): Promise<void> {
        this.playerId = generatePlayerId();
        const port = this.options.port || KASA_TALK_PORT;
        const auth = 'Basic ' + Buffer.from(
            `${this.options.username}:${md5Hex(this.options.password)}`,
        ).toString('base64');

        const search = new URLSearchParams({ playerId: this.playerId });

        const req = https.request({
            host: this.options.ip,
            port,
            method: 'POST',
            path: `${KASA_TALK_PATH}?${search.toString()}`,
            rejectUnauthorized: false,
            headers: {
                'Authorization': auth,
                'X-APP-ID': this.playerId,
                'Content-Type': `multipart/x-mixed-replace;boundary=${TALK_BOUNDARY}`,
                'Transfer-Encoding': 'chunked',
                'Connection': 'keep-alive',
                'Accept': '*/*',
            },
        });

        this.request = req;

        req.on('error', e => {
            this.options.console?.warn('kasa talk request error', e.message);
            this.close();
        });

        req.on('response', res => {
            this.options.console?.log(`kasa talk response: ${res.statusCode}`);
            res.on('data', () => { /* drain */ });
            res.on('end', () => this.close());
        });

        // Body is a PassThrough so we can write parts incrementally; pipe it into the request.
        this.body.pipe(req);

        // Heartbeat immediately + every 3 s, mirroring the Kasa app's idle pattern.
        this.writePart('audio/heartbeat', Buffer.alloc(0));
        this.heartbeatTimer = setInterval(() => {
            this.writePart('audio/heartbeat', Buffer.alloc(0));
        }, 3000);
    }

    // Returns false when the underlying stream is asking for backpressure (Node's standard
    // contract). Caller should pause its source until `drain` fires on `body`. We surface
    // this so an unhealthy/slow camera socket can't grow the PassThrough buffer without bound.
    writeAudio(chunk: Buffer): boolean {
        if (!chunk.length)
            return true;
        return this.writePart('audio/g711u', chunk);
    }

    onDrain(cb: () => void): void {
        this.body.once('drain', cb);
    }

    // Subscribe to the session's teardown event. If the session is already closed, the
    // callback is invoked on the next microtask so callers don't have to special-case timing.
    onClose(cb: () => void): void {
        if (this.closed) {
            queueMicrotask(cb);
            return;
        }
        this.closeCallbacks!.push(cb);
    }

    private writePart(contentType: string, body: Buffer): boolean {
        if (this.closed)
            return true;
        const header = `--${TALK_BOUNDARY}\r\nContent-Length: ${body.length}\r\nContent-Type: ${contentType}\r\n\r\n`;
        // Only the last write's return value matters for backpressure — if any of these
        // fills the buffer, Node will emit `drain` after the buffer empties.
        this.body.write(header);
        if (body.length)
            this.body.write(body);
        return this.body.write('\r\n');
    }

    close(): void {
        if (this.closed)
            return;
        this.closed = true;
        clearInterval(this.heartbeatTimer);
        try { this.body.end(); } catch { }
        try { this.request?.end(); } catch { }
        const cbs = this.closeCallbacks;
        // Drop the array reference before invoking callbacks so V8 can reclaim it; any
        // late onClose() registration after this point will be served via queueMicrotask.
        this.closeCallbacks = undefined;
        if (cbs) {
            for (const cb of cbs) {
                try { cb(); } catch (e) { this.options.console?.warn('kasa talk onClose handler threw', e); }
            }
        }
        this.resolveClosed();
    }
}
