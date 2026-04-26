import dgram from 'dgram';
import { networkInterfaces } from 'os';
import tls from 'tls';

export const KASA_DISCOVERY_PORT = 9999;
const KASA_DISCOVERY_PROBE = '{"system":{"get_sysinfo":{}}}';

// TP-Link Kasa "Smart Home" cipher: XOR autokey, initial key 0xAB.
// Each ciphertext byte becomes the next key, so encrypt and decrypt differ only in which byte
// (input vs. output) is fed forward.
function xorEncrypt(plaintext: string): Buffer {
    const buf = Buffer.from(plaintext, 'utf8');
    const out = Buffer.allocUnsafe(buf.length);
    let key = 0xAB;
    for (let i = 0; i < buf.length; i++) {
        const c = key ^ buf[i];
        out[i] = c;
        key = c;
    }
    return out;
}

function xorDecrypt(ciphertext: Buffer): string {
    const out = Buffer.allocUnsafe(ciphertext.length);
    let key = 0xAB;
    for (let i = 0; i < ciphertext.length; i++) {
        const c = ciphertext[i];
        out[i] = key ^ c;
        key = c;
    }
    return out.toString('utf8');
}

export interface KasaSysInfo {
    deviceId?: string;
    alias?: string;
    model?: string;
    mac?: string;
    mic_mac?: string;
    type?: string;
    mic_type?: string;
    sw_ver?: string;
    hw_ver?: string;
    [key: string]: unknown;
}

export interface KasaDiscoveredDevice {
    address: string;
    deviceId: string;
    alias: string;
    model: string;
    mac: string;
    type: string;
    sysinfo: KasaSysInfo;
}

// Compute IPv4 broadcast addresses of every non-loopback interface so the probe reaches every
// LAN even on hosts with multiple NICs. Falls back to the global 255.255.255.255 always.
function broadcastAddresses(): string[] {
    const addrs = new Set<string>(['255.255.255.255']);
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const info of ifaces[name] || []) {
            if (info.family !== 'IPv4' || info.internal)
                continue;
            const ip = info.address.split('.').map(Number);
            const mask = info.netmask.split('.').map(Number);
            if (ip.length !== 4 || mask.length !== 4)
                continue;
            const broadcast = ip.map((b, i) => (b & mask[i]) | (~mask[i] & 0xff));
            addrs.add(broadcast.join('.'));
        }
    }
    return [...addrs];
}

// Cameras that don't respond to UDP/9999 still listen for the streaming TLS endpoint on /24
// neighbors. We sweep TCP/19443 and treat any host that completes a TLS handshake (cert is
// always self-signed, so we skip verification) as a Kasa-camera candidate. Networks larger
// than /24 are skipped to avoid flooding.
function tcpSweepTargets(): string[] {
    const targets: string[] = [];
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const info of ifaces[name] || []) {
            if (info.family !== 'IPv4' || info.internal)
                continue;
            const mask = info.netmask.split('.').map(Number);
            if (mask.length !== 4 || mask[0] !== 255 || mask[1] !== 255 || mask[2] !== 255)
                continue;
            const ip = info.address.split('.').map(Number);
            const prefix = `${ip[0]}.${ip[1]}.${ip[2]}.`;
            for (let host = 1; host < 255; host++) {
                if (host === ip[3])
                    continue;
                targets.push(prefix + host);
            }
        }
    }
    return targets;
}

const TCP_PROBE_PORT = 19443;

// Probe a single host: open TCP and start the TLS handshake. We don't actually need the
// handshake to succeed (cert is self-signed and we'd need ALPN/SNI to match), only to confirm
// that something on this port answers like a TLS server. A bare TCP open could be any service,
// so we wait briefly for the TLS server hello to ensure it's not just a port-open black hole.
async function probeTcpHttps(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (v: boolean) => {
            if (settled) return;
            settled = true;
            resolve(v);
        };

        // Don't set servername — host is always an IP for the LAN sweep, and SNI with an IP
        // triggers Node's RFC 6066 deprecation warning. Cert validation is off anyway.
        const socket = tls.connect({
            host,
            port,
            rejectUnauthorized: false,
            timeout: timeoutMs,
        });
        socket.once('secureConnect', () => {
            socket.destroy();
            finish(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            finish(false);
        });
        socket.once('error', () => {
            socket.destroy();
            finish(false);
        });
    });
}

export interface KasaTcpCandidate {
    address: string;
    port: number;
}

export async function tcpProbeKasaCameras(timeoutMs: number = 2000, console?: Console): Promise<KasaTcpCandidate[]> {
    const targets = tcpSweepTargets();
    const found: KasaTcpCandidate[] = [];
    // Probe in parallel — TLS handshakes are cheap and a /24 finishes well within the budget.
    const results = await Promise.all(targets.map(async address => {
        const ok = await probeTcpHttps(address, TCP_PROBE_PORT, timeoutMs);
        return { address, ok };
    }));
    for (const { address, ok } of results) {
        if (ok)
            found.push({ address, port: TCP_PROBE_PORT });
    }
    console?.log(`kasa tcp probe: ${found.length} candidate(s) on port ${TCP_PROBE_PORT}`);
    return found;
}

export async function discoverKasa(durationMs: number = 3000, console?: Console): Promise<KasaDiscoveredDevice[]> {
    const found = new Map<string, KasaDiscoveredDevice>();
    const probe = xorEncrypt(KASA_DISCOVERY_PROBE);
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    return new Promise((resolve, reject) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            try { socket.close(); } catch { }
            resolve([...found.values()]);
        };

        socket.on('error', e => {
            if (done) return;
            done = true;
            try { socket.close(); } catch { }
            reject(e);
        });

        socket.on('message', (msg, rinfo) => {
            try {
                const json = JSON.parse(xorDecrypt(msg));
                const sys: KasaSysInfo | undefined = json?.system?.get_sysinfo;
                if (!sys)
                    return;
                const deviceId = sys.deviceId || sys.mic_mac || sys.mac;
                if (!deviceId)
                    return;
                if (found.has(deviceId))
                    return;
                found.set(deviceId, {
                    address: rinfo.address,
                    deviceId,
                    alias: sys.alias || '',
                    model: sys.model || '',
                    mac: (sys.mic_mac || sys.mac || '').toString(),
                    type: (sys.type || sys.mic_type || '').toString(),
                    sysinfo: sys,
                });
            }
            catch (e) {
                console?.warn('kasa discovery: failed to parse reply from', rinfo.address, e);
            }
        });

        socket.bind(0, () => {
            socket.setBroadcast(true);
            for (const addr of broadcastAddresses()) {
                socket.send(probe, KASA_DISCOVERY_PORT, addr, err => {
                    if (err)
                        console?.warn(`kasa discovery: broadcast to ${addr} failed:`, err.message);
                });
            }
            setTimeout(finish, durationMs);
        });
    });
}
