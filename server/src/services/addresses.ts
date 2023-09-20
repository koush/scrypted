import { Settings } from "../db-types";
import { ScryptedRuntime } from "../runtime";
import os from 'os';

export class AddressSettings {
    externalAddresses: {
        [id: string]: string[],
    } = {};

    constructor(public scrypted: ScryptedRuntime) {
    }

    async getExternalAddresses(id: string): Promise<string[]> {
        return this.externalAddresses[id] || [];
    }

    async setExternalAddresses(id: string, addresses: string[]) {
        this.externalAddresses[id] = addresses;
    }

    async setLocalAddresses(addresses: string[]) {
        const localAddresses = new Settings();
        localAddresses._id = 'localAddresses';
        localAddresses.value = addresses;
        await this.scrypted.datastore.upsert(localAddresses);
    }

    async getLocalAddresses(raw?: boolean): Promise<string[]> {
        const settings = await this.scrypted.datastore.tryGet(Settings, 'localAddresses');

        if (!settings?.value?.[0])
            return;

        const ret: string[] = [];
        const networkInterfaces = os.networkInterfaces();
        const allAddresses = new Set(Object.values(networkInterfaces)
            .flat().map(ni => ni.address));
        for (const addressOrInterface of settings.value) {
            const nif = networkInterfaces[addressOrInterface];
            if (raw) {
                ret.push(addressOrInterface);
            }
            else {
                if (nif) {
                    for (const addr of nif) {
                        if (!addr.address || addr.address.startsWith('169.254.') || addr.address.toLowerCase().startsWith('fe80:'))
                            continue;
                        ret.push(addr.address);
                    }
                }
                else {
                    if (allAddresses.has(addressOrInterface))
                        ret.push(addressOrInterface);
                    else
                        console.warn("invalid local address", addressOrInterface)
                }
            }
        }
        return ret;
    }
}
