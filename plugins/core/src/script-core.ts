import { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting } from "@scrypted/sdk";
import { Script } from "./script";
import sdk from '@scrypted/sdk';
import { randomBytes } from "crypto";
import fs from 'fs';
import path from "path/posix";

const { deviceManager } = sdk;
export const ScriptCoreNativeId = 'scriptcore';

export class ScriptCore extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator, Readme {
    scripts = new Map<string, Promise<Script>>();

    constructor() {
        super(ScriptCoreNativeId);

        for (const nativeId of deviceManager.getNativeIds()) {
            if (nativeId?.startsWith('script:')) {
                const script = new Script(nativeId);
                this.scripts.set(nativeId, (async () => {
                    if (script.providedInterfaces.length > 2) {
                        await script.run();
                    }
                    else {
                        this.reportScript(nativeId);
                    }
                    return script;
                })());
            }
        }
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                description: 'The name or description of the new script.',
            },
            {
                key: 'template',
                title: 'Template',
                description: 'The script template to use as a starting point.',
                choices: fs.readdirSync('examples').filter(f => fs.statSync('examples/' + f).isFile()).map(f => path.basename(f)),
            }
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const { name, template } = settings;
        const nativeId = 'script:' + randomBytes(8).toString('hex');
        await this.reportScript(nativeId, name?.toString());
        const script = new Script(nativeId);
        if (template) {
            try {
                await script.saveScript({
                    script: fs.readFileSync('examples/' + template).toString()
                        .split('\n')
                        .filter(line => !line.includes('SCRYPTED_FILTER_EXAMPLE_LINE'))
                        .join('\n')
                        .trim(),
                });
                await script.run();
            }
            catch (e) {
            }
        }
        this.scripts.set(nativeId, Promise.resolve(script));
        return nativeId;
    }

    async getReadmeMarkdown(): Promise<string> {
        return "Create powerful reusable scripts that can run complex actions or create custom devices."
    }

    async reportScript(nativeId: string, name?: string) {
        const device: Device = {
            providerNativeId: this.nativeId,
            name,
            nativeId,
            type: ScryptedDeviceType.Program,
            interfaces: [ScryptedInterface.Scriptable, ScryptedInterface.Program]
        }
        return await deviceManager.onDeviceDiscovered(device);
    }

    getDevice(nativeId: string) {
        return this.scripts.get(nativeId);
    }
}
