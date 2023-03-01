import sdk from '@scrypted/sdk';

export async function getUrlLocalAdresses(console: Console, url: string) {
    let urls: string[];
    try {
        const addresses = await sdk.endpointManager.getLocalAddresses();
        if (addresses) {
            const [address] = addresses;
            if (address) {
                const u = new URL(url);
                u.hostname = address;
                url = u.toString();
            }
            urls = addresses.map(address => {
                const u = new URL(url);
                u.hostname = address;
                return u.toString();
            });
        }
    }
    catch (e) {
        console.warn('Error determining external addresses. Is Scrypted Server Address configured?', e);
    }
    return urls;
}
