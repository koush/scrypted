import fs from 'fs';
import { httpFetch } from "../http-fetch-helpers";
import { ScryptedRuntime } from "../runtime";

export class ServiceControl {
    constructor(public scrypted: ScryptedRuntime) {
    }

    async exit() {
        fs.writeFileSync('.exit', '');
        this.restart();
    }

    async restart() {
        process.exit();
    }

    async getUpdateAvailable(): Promise<string> {
        throw new Error('getUpdateAvailable is not implemented. Updates will come out of band through Docker or npm.');
    }

    async update() {
        const webhookUpdate = process.env.SCRYPTED_WEBHOOK_UPDATE;
        if (webhookUpdate) {
            const webhookUpdateAuthorization = process.env.SCRYPTED_WEBHOOK_UPDATE_AUTHORIZATION;
            await httpFetch({
                url: webhookUpdate,
                headers: {
                    Authorization: webhookUpdateAuthorization,
                }
            });
        }
        else {
            fs.writeFileSync('.update', '');
            this.restart();
        }
    }
}
