import sdk from '@scrypted/sdk';
import net from 'net';

export async function getAddressOverride(type: 'udp6' | 'udp4') {
    try {
        const addresses = await sdk.endpointManager.getLocalAddresses();
        if (type === 'udp6') {
            return addresses?.find(address => net.isIPv6(address));
        }
        return addresses?.find(address => !net.isIPv6(address));
    }
    catch (e) {
    }
}

export async function getAddressOverrides() {
    try {
        const addresses = await sdk.endpointManager.getLocalAddresses();
        return addresses;
    }
    catch (e) {
    }
}
