import sdk from '@scrypted/sdk';

export async function getAddressOverride(legacy: string) {
    try {
        const addresses = await sdk.endpointManager.getLocalAddresses();
        const address = addresses?.[0];
        return address || legacy;
    }
    catch (e) {
        return legacy;
    }
}
