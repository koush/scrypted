import os from 'os';
import net from 'net';
import { add } from 'lodash';

const loopbackList = new net.BlockList();
loopbackList.addSubnet('127.0.0.0', 8);
loopbackList.addAddress('::1', 'ipv6');

const linkLocalList = new net.BlockList();
linkLocalList.addSubnet('169.254.0.0', 16);
linkLocalList.addSubnet('fe80::', 64, 'ipv6');

const privateList = new net.BlockList();
privateList.addSubnet('10.0.0.0', 8);
privateList.addSubnet('172.16.0.0', 12);
privateList.addSubnet('192.168.0.0', 16);
privateList.addSubnet('fc00::', 7, 'ipv6');

const benchmarkList = new net.BlockList();
benchmarkList.addSubnet('198.18.0.0', 15);

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

export function isUsableNetworkAddress(address: string) {
    address = removeIPv4EmbeddedIPv6(address);

    const type = net.isIPv6(address) ? 'ipv6' : 'ipv4';

    // ipv6 addresses are "usable" in the context of scrypted if they are public.
    if (type === 'ipv6' && privateList.check(address, type))
        return false;

    return !loopbackList.check(address, type)
        && !linkLocalList.check(address, type)
        && !benchmarkList.check(address, type);
}

export function getUsableNetworkAddresses() {
    const nis = os.networkInterfaces();
    const addresses: string[] = [];

    const addAddresses =  (family: string|number)  => {
        const adding = Object.values(nis)
            .flat()
            .filter((details) => details.family === family)
            .map((details) => details.address)
            .filter(isUsableNetworkAddress);
        addresses.push(...adding);
    }

    addAddresses('IPv4');
    addAddresses('IPv6');
    return addresses;
}
