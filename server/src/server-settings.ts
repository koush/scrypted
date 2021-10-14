import os from 'os';

export const SCRYPTED_INSECURE_PORT = parseInt(process.env.SCRYPTED_INSECURE_PORT) || 10080;
export const SCRYPTED_SECURE_PORT = parseInt(process.env.SCRYPTED_SECURE_PORT) || 9443;
export const SCRYPTED_DEBUG_PORT = parseInt(process.env.SCRYPTED_DEBUG_PORT) || 10081;

export function getIpAddress(): string {
    const ni = os.networkInterfaces();
    for (const i of [0, 1, 2, 3, 4, 5]) {
        let ipv4: os.NetworkInterfaceInfo;
        let ipv6: os.NetworkInterfaceInfo;
        for (const en of (ni[`en${i}`] || [])) {
            if (en.family === 'IPv4')
                ipv4 = en;
            else if (en.family === 'IPv6')
                ipv6 = en;
        }

        if (ipv4 || ipv6)
            return (ipv4 || ipv6).address;
    }

    return '127.0.0.1';
}
