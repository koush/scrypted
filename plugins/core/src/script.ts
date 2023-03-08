import sdk, { Scriptable, Program, ScryptedDeviceBase, ScriptSource, ScryptedInterface, ScryptedDeviceType } from "@scrypted/sdk";
import { scryptedEval } from "./scrypted-eval";
import { monacoEvalDefaults } from "./monaco";
import { createScriptDevice, ScriptDeviceImpl } from "@scrypted/common/src/eval/scrypted-eval";
import { ScriptCoreNativeId } from "./script-core";
import { PluginAPIProxy } from "../../../server/src/plugin/plugin-api";

const { log, deviceManager, systemManager } = sdk;

export class Script extends ScryptedDeviceBase implements Scriptable, Program, ScriptDeviceImpl {
    apiProxy: PluginAPIProxy;

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

    async postRunScript(defaultExport: any) {
        if (defaultExport) {
            let deviceInstance = defaultExport;
            // support exporting a plugin class, plugin main function,
            // or a plugin instance
            if (deviceInstance.toString().startsWith('class '))
                deviceInstance = new deviceInstance(this.nativeId);
            if (typeof deviceInstance === 'function')
                deviceInstance = await deviceInstance();
            this.handle(deviceInstance);
        }

        const allInterfaces = this.mergeHandler(this);
        if (allInterfaces.length !== 2) {
            await deviceManager.onDeviceDiscovered({
                providerNativeId: ScriptCoreNativeId,
                nativeId: this.nativeId,
                interfaces: allInterfaces,
                type: ScryptedDeviceType.Unknown,
                name: this.providedName,
            });
        }
    }

    prepareScript() {
        this.apiProxy?.removeListeners();

        Object.assign(this, createScriptDevice([
            ScryptedInterface.Scriptable,
            ScryptedInterface.Program,
        ]));
    }

    async run(variables?: { [name: string]: any; }): Promise<any> {
        this.prepareScript();

        try {
            const data = JSON.parse(this.storage.getItem('data'));

            const { value, defaultExport, apiProxy } = await scryptedEval(this, data['script.ts'], Object.assign({
                device: this,
            }, variables));

            this.apiProxy = apiProxy;

            await this.postRunScript(defaultExport);
            return value;
        }
        catch (e) {
            this.console.error('error loading script', e);
            throw e;
        }
    }

    async eval(source: ScriptSource, variables?: { [name: string]: any }) {
        this.prepareScript();

        const { value, defaultExport, apiProxy } = await scryptedEval(this, source.script, Object.assign({
            device: this,
        }, variables));

        this.apiProxy = apiProxy;

        await this.postRunScript(defaultExport);
        return value;
    }

    // will be done at runtime
    mergeHandler(device: ScryptedDeviceBase): string[] {
        throw new Error("Method not implemented.");
    }
    handle<T>(handler?: T & object): void {
        throw new Error("Method not implemented.");
    }
    handleTypes(...interfaces: string[]): void {
        throw new Error("Method not implemented.");
    }
}
