import { Settings } from "../db-types";
import { ScryptedRuntime } from "../runtime";

export class AddressSettings {
    constructor(public scrypted: ScryptedRuntime) {
    }

    async setLocalAddresses(addresses: string[]) {
        const localAddresses = new Settings();
        localAddresses._id = 'localAddresses';
        localAddresses.value = addresses;
        await this.scrypted.datastore.upsert(localAddresses);
    }

    async getLocalAddresses(): Promise<string[]> {
        const settings = await this.scrypted.datastore.tryGet(Settings, 'localAddresses');
        if (!settings?.value?.[0])
            return;
        return settings.value as string[];
    }
}
