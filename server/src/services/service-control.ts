import { ScryptedRuntime } from "../runtime";
import fs from 'fs';
import axios from "axios";

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

    async update() {
        const webhookUpdate = process.env.SCRYPTED_WEBHOOK_UPDATE;
        if (webhookUpdate) {
            const webhookUpdateAuthorization = process.env.SCRYPTED_WEBHOOK_UPDATE_AUTHORIZATION;
            const response = await axios.get(webhookUpdate, {
                headers: {
                    Authorization: webhookUpdateAuthorization,
                }
            });
            return response.data;
        }
        else {
            fs.writeFileSync('.update', '');
            this.restart();
        }
    }
}
