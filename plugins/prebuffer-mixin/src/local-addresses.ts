import net from 'net';
import sdk from '@scrypted/sdk';

export async function getUrlLocalAdresses(console: Console, url: string) {
    try {
        const addresses = await sdk.endpointManager.getLocalAddresses();
        if (!addresses)
            return;
        const urls = addresses.map(address => {
            const u = new URL(url);
            u.hostname = net.isIPv6(address) ? `[${address}]` : address;
            return u.toString();
        });
        return urls;
    }
    catch (e) {
        console.warn('Error determining external addresses. Is Scrypted Server Address configured?', e);
        return
    }
}
