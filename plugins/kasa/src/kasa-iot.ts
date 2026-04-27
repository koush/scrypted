import net from 'net';
import { xorDecrypt, xorEncryptInPlace } from './kasa-cipher';

// Legacy Kasa "IOT" protocol used by plugs, switches, and bulbs (everything that isn't a
// camera). Wire format on TCP/9999:
//   4-byte big-endian length prefix + XOR-AB(plaintext-json) bytes
// Same XOR-AB autokey cipher as UDP discovery; the only difference is the framing.
//
// Same-port UDP/9999 also accepts the encrypted JSON without the 4-byte prefix, but TCP
// is more reliable for control commands so we use it exclusively here.

export const KASA_IOT_PORT = 9999;
const REQUEST_TIMEOUT_MS = 5000;

export interface KasaIotOptions {
    host: string;
    port?: number;
    timeoutMs?: number;
}

export async function kasaIotCall(options: KasaIotOptions, command: Record<string, any>): Promise<any> {
    const port = options.port || KASA_IOT_PORT;
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const json = JSON.stringify(command);
    // Encode the 4-byte length prefix and JSON in one allocation, encrypt the JSON portion
    // in-place (we own this buffer and don't read the plaintext again).
    const jsonBytes = Buffer.byteLength(json, 'utf8');
    const payload = Buffer.allocUnsafe(4 + jsonBytes);
    payload.writeUInt32BE(jsonBytes, 0);
    payload.write(json, 4, 'utf8');
    xorEncryptInPlace(payload.subarray(4));

    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        // Queue of received TCP chunks plus byte total, so we don't repeatedly Buffer.concat
        // the accumulator on every 'data' event (O(n²) over multi-chunk responses; bulb
        // light_state replies span 2-3 chunks).
        const chunks: Buffer[] = [];
        let queuedBytes = 0;
        let expected = -1;
        let settled = false;

        const finish = (err?: Error, value?: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket.destroy(); } catch { }
            // Drop references so any retained chunks can be GC'd promptly.
            chunks.length = 0;
            if (err) reject(err);
            else resolve(value);
        };

        const timer = setTimeout(() => finish(new Error(`kasa iot call timeout after ${timeoutMs}ms`)), timeoutMs);

        const peek4 = (): number => {
            // We've verified queuedBytes >= 4 before calling. Read big-endian uint32 either
            // straight from the head buffer (common case) or after walking the queue.
            if (chunks[0].length >= 4)
                return chunks[0].readUInt32BE(0);
            // Rare: 4-byte length straddles two chunks. Concat just the first two.
            return Buffer.concat(chunks.slice(0, 2), 4).readUInt32BE(0);
        };

        const consume = (n: number): Buffer => {
            // Pop and return exactly n bytes from the head of the queue.
            queuedBytes -= n;
            if (chunks[0].length === n)
                return chunks.shift()!;
            if (chunks[0].length > n) {
                const out = chunks[0].subarray(0, n);
                chunks[0] = chunks[0].subarray(n);
                return out;
            }
            const out = Buffer.allocUnsafe(n);
            let written = 0;
            while (written < n) {
                const head = chunks[0];
                const need = n - written;
                if (head.length <= need) {
                    head.copy(out, written);
                    written += head.length;
                    chunks.shift();
                }
                else {
                    head.copy(out, written, 0, need);
                    chunks[0] = head.subarray(need);
                    written = n;
                }
            }
            return out;
        };

        socket.on('data', chunk => {
            chunks.push(chunk);
            queuedBytes += chunk.length;
            if (expected < 0) {
                if (queuedBytes < 4)
                    return;
                expected = peek4();
                consume(4);
            }
            if (queuedBytes >= expected) {
                const cipher = consume(expected);
                const plain = xorDecrypt(cipher).toString('utf8');
                try {
                    finish(undefined, JSON.parse(plain));
                }
                catch (e) {
                    finish(e as Error);
                }
            }
        });

        socket.on('error', e => finish(e));
        socket.on('close', () => {
            if (!settled)
                finish(new Error('kasa iot socket closed before response'));
        });

        socket.connect(port, options.host, () => {
            socket.write(payload);
        });
    });
}

// Common helpers used by both plugs/switches and bulbs.

export interface KasaSysInfoCommon {
    alias?: string;
    model?: string;
    mac?: string;
    mic_mac?: string;
    deviceId?: string;
    sw_ver?: string;
    hw_ver?: string;
    type?: string;
    mic_type?: string;
    dev_name?: string;
    feature?: string;
    [k: string]: any;
}

export async function getSysInfo(options: KasaIotOptions): Promise<KasaSysInfoCommon | undefined> {
    const r = await kasaIotCall(options, { system: { get_sysinfo: {} } });
    return r?.system?.get_sysinfo;
}
