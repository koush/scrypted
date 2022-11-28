import sdk from '@scrypted/sdk';

export async function getAddressOverride(legacy: string) {
    try {
        const service = await sdk.systemManager.getComponent('addresses');
        const addresses = await service.getLocalAddresses();
        const address = addresses?.[0];
        return address || legacy;
    }
    catch (e) {
        return legacy;
    }
}
