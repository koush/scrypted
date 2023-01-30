import sdk from '@scrypted/sdk';

export async function getAddressOverride() {
    try {
        const addresses = await sdk.endpointManager.getLocalAddresses();
        const address = addresses?.[0];
        return address;
    }
    catch (e) {
    }
}
