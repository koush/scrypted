import { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting } from "@scrypted/sdk";
import { Script } from "./script";
import sdk from '@scrypted/sdk';
import { randomBytes } from "crypto";
import fs from 'fs';
import path from "path/posix";
import { Worker } from "worker_threads";

const { deviceManager } = sdk;
export const ScriptCoreNativeId = 'scriptcore';

interface ScriptWorker {
    script: Script;
    worker: Worker;
}

export class ScriptCore extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator, Readme {
    scripts = new Map<string, ScriptWorker>();

    constructor() {
        super(ScriptCoreNativeId);
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

    async getDevice(nativeId: string) {
        const e = this.scripts.get(nativeId);
        if (e)
            return e;
        let script = new Script(nativeId);
        let worker: Worker;
        if (script.providedInterfaces.length > 2) {
            const fork = sdk.fork<{
                newScript: typeof newScript,
            }>();
            worker = fork.worker
            try {
                script = await (await fork.result).newScript(nativeId);
                await script.run();
            }
            catch (e) {
                worker.terminate();
                throw e;
            }
        }
        this.scripts.set(nativeId, {
            script,
            worker,
        });
        return script;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.scripts.get(nativeId)?.worker?.terminate();
    }
}

export async function newScript(nativeId: ScryptedNativeId) {
    return new Script(nativeId);
}
