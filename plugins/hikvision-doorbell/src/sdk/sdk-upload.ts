import { SdkInfo } from './sdk-package';

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const PROGRESS_STEP_BYTES = 1024 * 1024;
const DATA_MARKER = 0x00;

export interface SdkRequest
{
    isPublicEndpoint?: boolean;
    username?: string;
    aclId?: string;
    headers?: { [header: string]: string };
}

/**
 * Why a request to the SDK page, status or upload is refused, or undefined when it is
 * allowed. The upload installs native code that push mode runs, so it needs a signed-in
 * admin (no ACL) on the private endpoint, and browsers must come from the same origin
 * (a WebSocket carries the Scrypted login cookie from any site).
 */
export function refuseSdkRequest (request: SdkRequest): string | undefined
{
    if (request.isPublicEndpoint) {
        return 'public endpoint';
    }
    if (!request.username) {
        return 'not signed in';
    }
    if (request.aclId) {
        return 'restricted user';
    }
    const origin = request.headers?.origin;
    if (origin) {
        let originHost: string;
        try {
            originHost = new URL (origin).host;
        }
        catch {
            return 'invalid origin';
        }
        if (originHost !== request.headers?.host) {
            return 'cross-origin request';
        }
    }
    return undefined;
}

/**
 * One SDK zip upload over a WebSocket. Client protocol:
 *   {"start":{"size":N,"name":"..."}}   text
 *   0x00 + chunk                         binary, repeated
 *   {"end":true}                         text
 * Replies {"progress":bytes} about every 1 MB, then {"ok":SdkInfo} or {"error":"..."}.
 * Scrypted delivers text frames to the plugin as bytes too, so data frames carry a
 * leading 0x00 that JSON text never starts with.
 */
export class SdkUploadSession
{
    private expected?: number;
    private chunks: Buffer[] = [];
    private received = 0;
    private lastProgress = 0;
    private finished = false;

    constructor (private install: (zip: Buffer) => Promise<SdkInfo>, private send: (s: string) => void)
    {
    }

    onMessage (data: string | ArrayBufferLike | Uint8Array): void
    {
        if (typeof data === 'string') {
            this.onText (data);
            return;
        }
        const bytes = Buffer.isBuffer (data) ? data
            : data instanceof Uint8Array ? Buffer.from (data.buffer, data.byteOffset, data.byteLength)
            : Buffer.from (data);
        if (bytes.length && bytes[0] === DATA_MARKER) {
            this.onBinary (bytes.subarray (1));
        }
        else {
            this.onText (bytes.toString ('utf8'));
        }
    }

    onText (text: string): void
    {
        if (this.finished) {
            this.fail ('This upload has already finished. Reload the page to upload again.');
            return;
        }
        let message: any;
        try {
            message = JSON.parse (text);
        }
        catch {
            this.fail ('Unexpected message from the upload page.');
            return;
        }

        if (message?.start) {
            const size = message.start.size;
            if (typeof size !== 'number' || !Number.isInteger (size) || size <= 0) {
                this.fail ('The upload did not say how big the file is.');
            }
            else if (size > MAX_UPLOAD_BYTES) {
                this.fail (`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB, which is too big for an SDK zip.`);
            }
            else {
                this.expected = size;
                this.chunks = [];
                this.received = 0;
                this.lastProgress = 0;
            }
            return;
        }

        if (message?.end) {
            if (this.expected === undefined) {
                this.fail ('The upload ended before it started.');
                return;
            }
            if (this.received !== this.expected) {
                this.fail (`Received ${this.received} of ${this.expected} bytes. Try the upload again.`);
                return;
            }
            const zip = Buffer.concat (this.chunks);
            this.chunks = [];
            this.finished = true;
            this.install (zip).then (
                (info) => this.send (JSON.stringify ({ ok: info })),
                (e) => this.send (JSON.stringify ({ error: e?.message || String (e) })));
            return;
        }

        this.fail ('Unexpected message from the upload page.');
    }

    onBinary (chunk: Buffer): void
    {
        if (this.finished) {
            this.fail ('This upload has already finished. Reload the page to upload again.');
            return;
        }
        if (this.expected === undefined) {
            this.fail ('File data arrived before the upload started.');
            return;
        }
        this.received += chunk.length;
        if (this.received > this.expected) {
            this.fail (`Received more than the announced ${this.expected} bytes. Try the upload again.`);
            return;
        }
        this.chunks.push (Buffer.from (chunk));
        if (this.received - this.lastProgress >= PROGRESS_STEP_BYTES) {
            this.lastProgress = this.received;
            this.send (JSON.stringify ({ progress: this.received }));
        }
    }

    private fail (error: string)
    {
        this.finished = true;
        this.expected = undefined;
        this.chunks = [];
        this.send (JSON.stringify ({ error }));
    }
}
