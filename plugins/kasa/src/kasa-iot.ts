import net from 'net';
import { xorDecrypt, xorEncrypt } from './kasa-cipher';

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
    const encrypted = xorEncrypt(Buffer.from(json, 'utf8'));
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(encrypted.length, 0);
    const payload = Buffer.concat([lenBuf, encrypted]);

    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let received = Buffer.alloc(0);
        let expected = -1;
        let settled = false;

        const finish = (err?: Error, value?: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket.destroy(); } catch { }
            if (err) reject(err);
            else resolve(value);
        };

        const timer = setTimeout(() => finish(new Error(`kasa iot call timeout after ${timeoutMs}ms`)), timeoutMs);

        socket.on('data', chunk => {
            received = received.length ? Buffer.concat([received, chunk]) : chunk;
            if (expected < 0) {
                if (received.length < 4)
                    return;
                expected = received.readUInt32BE(0);
                received = received.subarray(4);
            }
            if (received.length >= expected) {
                const cipher = received.subarray(0, expected);
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
