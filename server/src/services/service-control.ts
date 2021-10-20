import { ScryptedRuntime } from "../runtime";
import fs from 'fs';

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
        fs.writeFileSync('.update', '');
        this.restart();
    }
}
