import { Settings } from "../db-types";
import { ScryptedRuntime } from "../runtime";
import os from 'os';

export class AddressSettings {
    constructor(public scrypted: ScryptedRuntime) {
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
        for (const addressOrInterface of settings.value) {
            const nif = networkInterfaces[addressOrInterface];
            if (!raw && nif) {
                for (const addr of nif) {
                    ret.push(addr.address);
                }
            }
            else {
                ret.push(addressOrInterface);
            }
        }
        return ret;
    }
}
