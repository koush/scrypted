import sdk, { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, ForkWorker, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting } from '@scrypted/sdk';
import { randomBytes } from "crypto";
import fs from 'fs';
import path from "path/posix";
import { Worker } from "worker_threads";
import { Script } from "./script";

const { deviceManager } = sdk;
export const ScriptCoreNativeId = 'scriptcore';

interface ScriptWorker {
    script?: Script;
    worker?: ForkWorker;
}

export class ScriptCore extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator, Readme {
    scripts = new Map<string, Promise<ScriptWorker>>();

    constructor() {
        super(ScriptCoreNativeId);

        this.systemDevice = {
            deviceCreator: 'Script',
        };
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        const settings: Setting[] = [
            {
                key: 'name',
                title: 'Name',
                description: 'The name or description of the new script.',
            },
            {
                key: 'template',
                type: 'html',
                value: `Learn more about scripts at <a href='https://scripts.scrypted.app'>scripts.scrypted.app.</a>`,
            }
        ];

        if (sdk.clusterManager?.getClusterMode?.() === 'server') {
            const workers = await sdk.clusterManager.getClusterWorkers();
            const clients = Object.values(workers).filter(worker => worker.mode === 'client');
            if (clients.length) {
                const labels = [...new Set(clients.flatMap(worker => worker.labels))].sort();
                settings.splice(1, 0, {
                    key: 'labels',
                    title: 'Cluster Labels',
                    description: 'The labels of the cluster workers where this script will run. This cannot be changed later.',
                    multiple: true,
                    combobox: true,
                    choices: labels,
                });
            }
        }

        return settings;
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const { name } = settings;
        const labels = settings.labels as string[] | undefined;
        const nativeId = 'script:' + randomBytes(8).toString('hex');
        await this.reportScript(nativeId, name?.toString());
        if (labels?.length)
            await new Script(nativeId).setClusterLabels(labels);
        return nativeId;
    }

    async getReadmeMarkdown(): Promise<string> {
        return "Create powerful reusable scripts that can run complex actions or create custom devices."
    }

    async reportScript(nativeId: string, name?: string) {
        const device: Device = {
            providerNativeId: this.nativeId,
            name: name!,
            nativeId,
            type: ScryptedDeviceType.Program,
            interfaces: [ScryptedInterface.Scriptable, ScryptedInterface.Program]
        }
        return await deviceManager.onDeviceDiscovered(device);
    }

    async getDevice(nativeId: string) {
        while (true) {
            const e = this.scripts.get(nativeId);
            if (!e)
                break;
            const resolved = await e;
            const script = resolved.script;
            if (script) {
                if (!resolved.worker && script.providedInterfaces.length > 2)
                    resolved.script = undefined;
                else
                    return script;
            }
            resolved.worker?.terminate();
            if (this.scripts.get(nativeId) === e)
                this.scripts.delete(nativeId);
        }

        const scriptWorker: Promise<ScriptWorker> = (async () => {
            let worker: ForkWorker | undefined;

            const triggerDeviceDiscover = async (name: string, type: ScryptedDeviceType | string, interfaces: string[]) => {
                const e = this.scripts.get(nativeId);
                if (e === scriptWorker) {
                    const resolved = await e;
                    resolved.script = undefined;
                }

                const device: Device = {
                    providerNativeId: this.nativeId,
                    name,
                    nativeId,
                    type,
                    interfaces,
                    refresh: true,
                };
                return await deviceManager.onDeviceDiscovered(device);
            };

            let script = new Script(nativeId);

            if (script.providedInterfaces.length > 2) {
                const clusterLabels = await script.getClusterLabels();
                const fork = sdk.fork<{
                    newScript: typeof newScript,
                }>(clusterLabels.length ? {
                    labels: {
                        require: clusterLabels,
                    },
                } : undefined);
                worker = fork.worker;
                try {
                    script = await (await fork.result).newScript(nativeId, triggerDeviceDiscover);
                }
                catch (e) {
                    worker.terminate();
                    // throw e;
                }
            }

            worker?.on('exit', async () => {
                const e = this.scripts.get(nativeId);
                if (e === scriptWorker) {
                    this.scripts.delete(nativeId);
                    // notify the system that the device needs to be refreshed.
                    if (deviceManager.getNativeIds().includes(nativeId)) {
                        const script = new Script(nativeId);
                        await triggerDeviceDiscover(script.providedName!, script.providedType!, script.providedInterfaces);
                    }
                }
            });

            return {
                script,
                worker,
            };
        })();

        this.scripts.set(nativeId, scriptWorker);
        try {
            return (await scriptWorker).script;
        }
        catch (e) {
            if (this.scripts.get(nativeId) === scriptWorker)
                this.scripts.delete(nativeId);
            throw e;
        }
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        const e = await this.scripts.get(nativeId);
        const worker = e?.worker;
        this.scripts.delete(nativeId);
        worker?.terminate();
    }
}

export async function newScript(nativeId: ScryptedNativeId, triggerDeviceDiscover: (name: string, type: ScryptedDeviceType | string, interfaces: string[]) => Promise<string>) {
    const script = new Script(nativeId, triggerDeviceDiscover);
    await script.run();
    return script;
}
