import net from 'net';
import sdk from '@scrypted/sdk';

export async function getUrlLocalAdresses(console: Console, url: string) {
    let urls: string[];
    try {
        const addresses = await sdk.endpointManager.getLocalAddresses();
        if (addresses) {
            urls = addresses.map(address => {
                const u = new URL(url);
                u.hostname = net.isIPv6(address) ? `[${address}]` : address;
                return u.toString();
            });
        }
    }
    catch (e) {
        console.warn('Error determining external addresses. Is Scrypted Server Address configured?', e);
    }

    if (process.env.SCRYPTED_CLUSTER_ADDRESS) {
        try {
            const clusterUrl = new URL(url);
            clusterUrl.hostname = process.env.SCRYPTED_CLUSTER_ADDRESS;
            const str = clusterUrl.toString();
            if (!urls?.includes(str)) {
                urls ||= [];
                urls.push(str);
            }
        }
        catch (e) {
            console.warn('Error determining external addresses. Is Scrypted Cluster Address configured?', e);
        }
    }

    return urls;
}
