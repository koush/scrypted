import { Javascript, Program, ScryptedDeviceBase } from "@scrypted/sdk";
import { scryptedEval } from "./scrypted-eval";

export class Script extends ScryptedDeviceBase implements Javascript, Program {
    constructor(nativeId: string) {
        super(nativeId);
    }

    run(variables?: { [name: string]: any; }): Promise<any> {
        try {
            const data = JSON.parse(this.storage.getItem('data'));
            return scryptedEval(this, data.script, variables);
        }
        catch (e) {
            this.log.e('error loading script');
            this.console.error(e);
        }
    }

    async eval(script: string, variables: { [name: string]: any }) {
        return scryptedEval(this, script, variables);
    }
}
