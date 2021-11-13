import { Scriptable, Program, ScryptedDeviceBase, ScriptSource } from "@scrypted/sdk";
import { createMonacoEvalDefaults } from "../../../common/src/scrypted-eval";
import { scryptedEval } from "./scrypted-eval";

const monacoEvalDefaults = createMonacoEvalDefaults({});

export class Script extends ScryptedDeviceBase implements Scriptable, Program {
    constructor(nativeId: string) {
        super(nativeId);
    }

    async saveScript(source: ScriptSource): Promise<void> {
        this.storage.setItem('data', JSON.stringify({
            'script.ts': source.script,
        }));
    }

    async loadScripts(): Promise<{ [filename: string]: ScriptSource; }> {
        try {
            const scripts = JSON.parse(this.storage.getItem('data'));
            // currently only support 1 script
            return {
                'script.ts': {
                    name: 'Script',
                    script: scripts['script.ts'],
                    language: 'typescript',
                    monacoEvalDefaults,
                }
            }
        }
        catch (e) {
            return {
                'script.ts': {
                    name: 'Script',
                    script: '',
                    language: 'typescript',
                    monacoEvalDefaults,
                },
            }
        }
    }

    run(variables?: { [name: string]: any; }): Promise<any> {
        try {
            const data = JSON.parse(this.storage.getItem('data'));
            return scryptedEval(this, data['script.ts'], variables);
        }
        catch (e) {
            this.log.e('error loading script');
            this.console.error(e);
        }
    }

    async eval(source: ScriptSource, variables: { [name: string]: any }) {
        return scryptedEval(this, source.script, variables);
    }
}
