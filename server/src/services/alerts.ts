import { ScryptedAlert } from "../db-types";
import { ScryptedRuntime } from "../runtime";

export class Alerts {
    constructor(public scrypted: ScryptedRuntime) {
    }

    async getAlerts(): Promise<ScryptedAlert[]> {
        const ret = [];
        for await (const alert of this.scrypted.datastore.getAll(ScryptedAlert)) {
            ret.push(alert);
        }
        return ret;
    }
    async removeAlert(alert: ScryptedAlert) {
        await this.scrypted.datastore.removeId(ScryptedAlert, alert._id);
        this.scrypted.stateManager.notifyInterfaceEvent(null, 'Logger' as any, undefined);
    }
    async clearAlerts() {
        await this.scrypted.datastore.removeAll(ScryptedAlert);
        this.scrypted.stateManager.notifyInterfaceEvent(null, 'Logger' as any, undefined);
    }
}
