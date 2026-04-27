import dgram from 'dgram';
import { networkInterfaces } from 'os';
import { xorDecrypt as xorDecryptBuf, xorEncrypt as xorEncryptBuf } from './kasa-cipher';

export const KASA_DISCOVERY_PORT = 9999;
const KASA_DISCOVERY_PROBE = '{"system":{"get_sysinfo":{}}}';

const xorEncryptString = (s: string) => xorEncryptBuf(Buffer.from(s, 'utf8'));
const xorDecryptToString = (b: Buffer) => xorDecryptBuf(b).toString('utf8');

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

// All host IPs in each local /24 we're attached to (excluding our own). Used for both UDP
// unicast sweeps (when broadcast misses cameras) and the legacy TCP/19443 sweep. Networks
// larger than /24 are skipped to avoid flooding.
function localSubnetIps(): string[] {
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

// One-shot UDP discovery: send a broadcast, then a paced unicast probe at every IP on the
// local /24, all on a single socket while listening for replies. Cameras that ignore
// broadcast (newer KC420WS firmware does) still answer the unicast hit. Pacing the unicast
// sends a few ms apart prevents the network/kernel from dropping the burst — sending 250
// packets back-to-back was the reason the earlier UDP-only attempt missed cameras.
export async function discoverKasa(durationMs: number = 2500, console?: Console): Promise<KasaDiscoveredDevice[]> {
    const found = new Map<string, KasaDiscoveredDevice>();
    const probe = xorEncryptString(KASA_DISCOVERY_PROBE);
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
                const json = JSON.parse(xorDecryptToString(msg));
                const sys = extractSysInfo(json);
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

        socket.bind(0, async () => {
            socket.setBroadcast(true);
            // Hard deadline starts now; unicast pacing happens during the same window.
            setTimeout(finish, durationMs);

            for (const addr of broadcastAddresses())
                socket.send(probe, KASA_DISCOVERY_PORT, addr);

            // Paced unicast — ~3 ms between sends keeps a /24 sweep under 1 s of network
            // traffic without flooding. Suppress per-target send errors (EHOSTDOWN spam from
            // dead IPs is uninteresting and would dominate the log).
            for (const addr of localSubnetIps()) {
                if (done)
                    break;
                socket.send(probe, KASA_DISCOVERY_PORT, addr, () => { });
                await new Promise(r => setTimeout(r, 3));
            }
        });
    });
}
