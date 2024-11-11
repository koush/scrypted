import os from 'os';
import net from 'net';

export const loopbackList = new net.BlockList();
loopbackList.addSubnet('127.0.0.0', 8);
loopbackList.addAddress('::1', 'ipv6');

const unusableList = new net.BlockList();

// link local
unusableList.addSubnet('169.254.0.0', 16);
unusableList.addSubnet('fe80::', 64, 'ipv6');

// cg nat
unusableList.addSubnet('100.64.0.0', 10);

// documentation and testing
unusableList.addSubnet('192.0.2.0', 24);
unusableList.addSubnet('198.51.100.0', 24);
unusableList.addSubnet('203.0.113.0', 24);

// reserved
unusableList.addSubnet('0.0.0.0', 8);
unusableList.addSubnet('240.0.0.0', 4);

// benchmarking
unusableList.addSubnet('198.18.0.0', 15);

const privateList = new net.BlockList();
privateList.addSubnet('10.0.0.0', 8);
privateList.addSubnet('172.16.0.0', 12);
privateList.addSubnet('192.168.0.0', 16);
privateList.addSubnet('fc00::', 7, 'ipv6');


export function isIPv4EmbeddedIPv6(address: string) {
    // this is valid ipv6 address with ipv4 embedded
    // ::ffff:10.0.0.1
    return net.isIPv6(address) && address.startsWith('::ffff:');
}

export function removeIPv4EmbeddedIPv6(address: string) {
    if (isIPv4EmbeddedIPv6(address))
        return address.slice(7);
    return address;
}

function isUsableNetworkAddress(address: string) {
    if (!address)
        return false;
    try {
        address = removeIPv4EmbeddedIPv6(address);

        const type = net.isIPv6(address) ? 'ipv6' : 'ipv4';

        // ipv6 addresses are "usable" in the context of scrypted if they are public.
        if (type === 'ipv6' && privateList.check(address, type))
            return false;

        return !unusableList.check(address, type) && !loopbackList.check(address, type);
    }
    catch (e) {
        return false;
    }
}

export function getUsableNetworkAddresses() {
    const nis = os.networkInterfaces();

    const getUsable = (family: string | number) => {
        const usable = Object.values(nis)
            .flat()
            .filter((details) => details.family === family)
            .filter(details => isUsableNetworkAddress(details.address));
        return usable;
    }

    const ipv4 = getUsable('IPv4');
    const ipv6 = getUsable('IPv6');

    // ipv6 generates temporary per connection ips that we want to filter out.

    // 2001:abc:def::7b0
    const fixedAddresses = ipv6.filter(details => details.address.includes('::'));
    const fixedRanges = fixedAddresses.map(details => {
        const block = new net.BlockList();
        const cidr = parseInt(details.address.split('/')[1]) || 1;
        block.addSubnet(details.address, cidr, 'ipv6');
        return block;
    });

    // 2001:abc:def:0:dc:28a7:261b:9324
    const fixedFiltered = ipv6.filter(details => {
        for (const block of fixedRanges) {
            if (block.check(details.address, 'ipv6'))
                return false;
        }
        return true;
    });

    return [
        ...ipv4.map(details => details.address),
        ...fixedAddresses.map(details => details.address),
        ...fixedFiltered.map(details => details.address),
    ];
}
