import { Scriptable, Program, ScryptedDeviceBase, ScriptSource } from "@scrypted/sdk";
import { scryptedEval } from "./scrypted-eval";

const types = require("!!raw-loader!@scrypted/sdk/types.d.ts");
const sdk = require("!!raw-loader!@scrypted/sdk/index.d.ts");

function monacoEvalDefaultsFunction(monaco) {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
        Object.assign(
            {},
            monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
            {
                moduleResolution:
                    monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            }
        )
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(`
      ${types}
      ${sdk}
      
      declare global {
        ${types.replace("export interface", "interface")}
  
        const log: Logger;
  
        const deviceManager: DeviceManager;
        const endpointManager: EndpointManager;
        const mediaManager: MediaManager;
        const systemManager: SystemManager;
        const eventSource: any;
        const eventDetails: EventDetails;
        const eventData: any;
      }
      `,

        "node_modules/@types/scrypted__sdk/types.d.ts"
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
        sdk,
        "node_modules/@types/scrypted__sdk/index.d.ts"
    );
}

const monacoEvalDefaults = `(function() {
const types = \`${types}\`;
const sdk = \`${sdk}\`;

return ${monacoEvalDefaultsFunction};
})();
`;

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
            return scryptedEval(this, data.script, variables);
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
