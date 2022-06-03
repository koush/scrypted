import os from 'os';
import * as nodeIp from 'ip';

export const SCRYPTED_INSECURE_PORT = parseInt(process.env.SCRYPTED_INSECURE_PORT) || 11080;
export const SCRYPTED_SECURE_PORT = parseInt(process.env.SCRYPTED_SECURE_PORT) || 10443;
export const SCRYPTED_DEBUG_PORT = parseInt(process.env.SCRYPTED_DEBUG_PORT) || 10081;

export function getIpAddress(): string {
    return nodeIp.address();
}

function nodeIpAddress(family: string): string[] {
    // https://chromium.googlesource.com/external/webrtc/+/master/rtc_base/network.cc#236
    const costlyNetworks = ["ipsec", "tun", "utun", "tap"];

    const interfaces = os.networkInterfaces();

    const all = Object.keys(interfaces)
        .map((nic) => {
            for (const costly of costlyNetworks) {
                if (nic.startsWith(costly)) {
                    return {
                        nic,
                        addresses: [],
                    };
                }
            }
            const addresses = interfaces[nic]!.filter(
                (details) =>
                    details.family.toLowerCase() === family &&
                    !nodeIp.isLoopback(details.address)
            );
            return {
                nic,
                addresses: addresses.map((address) => address.address),
            };
        })
        .filter((address) => !!address);

    // os.networkInterfaces doesn't actually return addresses in a good order.
    // have seen instances where en0 (ethernet) is after en1 (wlan), etc.
    // eth0 > eth1
    all.sort((a, b) => a.nic.localeCompare(b.nic));
    return Object.values(all)
        .map((entry) => entry.addresses)
        .flat();
}

export function getHostAddresses(useIpv4: boolean, useIpv6: boolean) {
    const address: string[] = [];
    if (useIpv4) address.push(...nodeIpAddress("ipv4"));
    if (useIpv6) address.push(...nodeIpAddress("ipv6"));
    return address;
}
