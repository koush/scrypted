import fs from 'fs';
import { httpFetch } from "../fetch/http-fetch";

export class ServiceControl {
    async restart() {
        // legacy file necessary to exit the npx scrypted service,
        // and allow it to be restarted by launchd or systemd.
        fs.writeFileSync('.exit', '');
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
