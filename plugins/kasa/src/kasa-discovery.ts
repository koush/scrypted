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

interface ProbeResult {
    ok: boolean;
    certInfo?: {
        cn?: string;
        ou?: string;
        o?: string;
        san?: string;
    };
}

// Probe a single host: open TCP and start the TLS handshake. We don't actually need the
// handshake to succeed (cert is self-signed and we'd need ALPN/SNI to match), only to confirm
// that something on this port answers like a TLS server. We capture the peer certificate's
// subject and SAN on the way out so we can label the candidate.
async function probeTcpHttps(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (v: ProbeResult) => {
            if (settled) return;
            settled = true;
            resolve(v);
        };

        const socket = tls.connect({
            host,
            port,
            rejectUnauthorized: false,
            timeout: timeoutMs,
        });
        socket.once('secureConnect', () => {
            const cert = socket.getPeerCertificate(false);
            const subject = cert?.subject || {};
            socket.destroy();
            finish({
                ok: true,
                certInfo: {
                    cn: typeof subject.CN === 'string' ? subject.CN : undefined,
                    ou: typeof subject.OU === 'string' ? subject.OU : undefined,
                    o: typeof subject.O === 'string' ? subject.O : undefined,
                    san: typeof cert?.subjectaltname === 'string' ? cert.subjectaltname : undefined,
                },
            });
        });
        socket.once('timeout', () => {
            socket.destroy();
            finish({ ok: false });
        });
        socket.once('error', () => {
            socket.destroy();
            finish({ ok: false });
        });
    });
}

// Best-effort extract of a model identifier ("KC401", "KD110", "EC71", "KC420WS", etc.) from
// any subject/SAN string the camera presents. We accept things like "kasa-kc401-...",
// "KC401(US)", "DNS:kd110-abcd". Returns undefined when no candidate token is found.
function modelFromCertInfo(info?: ProbeResult['certInfo']): string | undefined {
    if (!info)
        return;
    const blob = [info.cn, info.ou, info.o, info.san].filter(Boolean).join(' ');
    const m = /\b([A-Za-z]{2,3}\d{2,4}[A-Za-z]{0,3})(?:\(([^)]+)\))?\b/.exec(blob);
    if (!m)
        return;
    const model = m[1].toUpperCase();
    return m[2] ? `${model}(${m[2]})` : model;
}

export interface KasaTcpCandidate {
    address: string;
    port: number;
    certInfo?: ProbeResult['certInfo'];
    model?: string;
}

export async function tcpProbeKasaCameras(timeoutMs: number = 2000, console?: Console): Promise<KasaTcpCandidate[]> {
    const targets = tcpSweepTargets();
    const found: KasaTcpCandidate[] = [];
    const results = await Promise.all(targets.map(async address => {
        const result = await probeTcpHttps(address, TCP_PROBE_PORT, timeoutMs);
        return { address, ...result };
    }));
    for (const r of results) {
        if (r.ok)
            found.push({
                address: r.address,
                port: TCP_PROBE_PORT,
                certInfo: r.certInfo,
                model: modelFromCertInfo(r.certInfo),
            });
    }
    console?.log(`kasa tcp probe: ${found.length} candidate(s) on port ${TCP_PROBE_PORT}`);
    return found;
}

// Best-effort extraction of sysinfo-like fields from a JSON response. Different Kasa device
// families nest the same data under different keys (system.get_sysinfo for plugs, smartlife
// .iot.IPCamera.* for cameras, etc.), so walk the tree and pick up whatever looks right.
function extractSysInfo(json: any): KasaSysInfo | undefined {
    if (!json || typeof json !== 'object')
        return;
    const candidates: any[] = [];
    const walk = (node: any, depth: number) => {
        if (!node || typeof node !== 'object' || depth > 4)
            return;
        if (typeof node.model === 'string' || typeof node.alias === 'string'
            || typeof node.deviceId === 'string' || typeof node.dev_id === 'string')
            candidates.push(node);
        for (const v of Object.values(node))
            walk(v, depth + 1);
    };
    walk(json, 0);
    if (!candidates.length)
        return;
    // Prefer the candidate with the most identifying fields populated.
    candidates.sort((a, b) => fieldCount(b) - fieldCount(a));
    const best = candidates[0];
    return {
        deviceId: best.deviceId || best.dev_id,
        alias: best.alias,
        model: best.model || best.hwId || best.hw_id,
        mac: best.mic_mac || best.mac,
        type: best.type || best.mic_type || best.deviceType,
        ...best,
    };
}

function fieldCount(o: any): number {
    let n = 0;
    if (o.model) n++;
    if (o.alias) n++;
    if (o.deviceId || o.dev_id) n++;
    if (o.mac || o.mic_mac) n++;
    if (o.type || o.mic_type) n++;
    return n;
}

// Send the IOT.SMARTHOME `get_sysinfo` query as a unicast packet to a specific list of IPs
// (typically the TCP probe survivors). Some Kasa camera firmwares ignore broadcast probes
// but still respond to a direct query, so this fills in metadata that broadcast misses.
export async function unicastProbeKasa(ips: string[], durationMs: number = 2000, console?: Console): Promise<Map<string, KasaSysInfo>> {
    const found = new Map<string, KasaSysInfo>();
    if (!ips.length)
        return found;
    const probe = xorEncrypt(KASA_DISCOVERY_PROBE);
    const socket = dgram.createSocket('udp4');

    return new Promise((resolve, reject) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            try { socket.close(); } catch { }
            resolve(found);
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
                const sys = extractSysInfo(json);
                if (sys)
                    found.set(rinfo.address, sys);
            }
            catch (e) {
                console?.warn(`kasa unicast: parse failed from ${rinfo.address}:`, e);
            }
        });

        socket.bind(0, () => {
            for (const ip of ips) {
                socket.send(probe, KASA_DISCOVERY_PORT, ip, err => {
                    if (err)
                        console?.warn(`kasa unicast: send to ${ip} failed:`, err.message);
                });
            }
            setTimeout(finish, durationMs);
        });
    });
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
