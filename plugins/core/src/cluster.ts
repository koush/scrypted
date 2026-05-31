import { createAsyncQueue } from "@scrypted/common/src/async-queue";
import sdk, { Readme, ScryptedDeviceBase, ScryptedInterface, ScryptedSettings, Setting, Settings } from "@scrypted/sdk";

export const ClusterCoreNativeId = 'clustercore';

export class ClusterCore extends ScryptedDeviceBase implements Settings, Readme, ScryptedSettings {
    writeQueue = createAsyncQueue<() => Promise<void>>();

    constructor(nativeId: string) {
        super(nativeId);

        (async () => {
            for await (const write of this.writeQueue.queue) {
                try {
                    await write();
                }
                catch (e) {
                    this.console.error('error writing settings', e);
                }
                finally {
                    this.onDeviceEvent(ScryptedInterface.Settings, undefined);
                }
            }
        })();
    }

    async getSettings(): Promise<Setting[]> {
        const mode = sdk.clusterManager?.getClusterMode?.();
        if (!mode)
            return [];

        const workers = await sdk.clusterManager.getClusterWorkers();

        const ret: Setting[] = [];

        const clientWorkers = Object.values(workers);

        const clusterFork = await sdk.systemManager.getComponent('cluster-fork');

        for (const worker of clientWorkers) {
            const group = `Worker: ${worker.name}`;
            const name: Setting = {
                key: `${worker.id}:name`,
                group,
                title: 'Name',
                description: 'The friendly name of the worker.',
                value: worker.name,
            };
            ret.push(name);

            const mode: Setting = {
                key: `${worker.id}:mode`,
                group,
                title: 'Mode',
                description: 'The mode of the worker.',
                value: worker.mode,
                readonly: true,
            };
            ret.push(mode);


            const envControl = await clusterFork.getEnvControl(worker.id);
            // catch in case env is coming from vscode launch.json and no .env actually exists.
            const dotEnv: string = await envControl.getDotEnv().catch(() => {});
            const dotEnvLines = dotEnv?.split('\n') || worker.labels;
            const dotEnvParsed = dotEnvLines.map(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('#')) {
                    return { line };
                }
                const [key, ...value] = trimmed.split('=');
                return { key, value: value.join('='), line };
            });

            const workerLabels = dotEnvParsed.find(line => line.key === 'SCRYPTED_CLUSTER_LABELS')?.value?.split(',') || [];

            const labelChoices = new Set<string>([
                ...workerLabels,
                'storage',
                'compute',
                'compute.preferred',
                '@scrypted/coreml',
                '@scrypted/openvino',
                '@scrypted/onnx',
                '@scrypted/tensorflow-lite',
            ]);
            const labels: Setting = {
                key: `${worker.id}:labels`,
                group,
                title: 'Labels',
                description: 'The labels to apply to this worker. Modifying the labels will restart the worker. Some labels, such as the host OS and architecture, cannot be changed.',
                multiple: true,
                combobox: true,
                choices: [...labelChoices],
                value: workerLabels,
            };
            ret.push(labels);
        }

        return ret;
    }

    async putSetting(key: string, value: any) {
        await this.writeQueue.enqueue(async () => {
            const split = key.split(':');
            const [workerId, setting] = split;
            const workers = await sdk.clusterManager.getClusterWorkers();
            const worker = workers[workerId];
            if (!worker)
                return;


            switch (setting) {
                case 'name':
                case 'labels':
                    break;
                default:
                    return;
            }

            const clusterFork = await sdk.systemManager.getComponent('cluster-fork');
            const envControl = await clusterFork.getEnvControl(worker.id);
            const dotEnv: string = await envControl.getDotEnv().catch(() => {});

            const dotEnvLines = dotEnv?.split('\n') || worker.labels;
            const dotEnvParsed = dotEnvLines.map(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('#')) {
                    return { line };
                }
                const [key, ...value] = trimmed.split('=');
                return { key, value: value.join('='), line };
            });

            const updateDotEnv = async (key: string, newValue: string) => {
                let entry = dotEnvParsed.find(line => line.key === key);
                if (!entry) {
                    entry = { key, value: '', line: '' };
                    dotEnvParsed.push(entry);
                }
                entry.line = `${key}=${newValue}`;
                await envControl.setDotEnv(dotEnvParsed.filter(line => line).map(line => line.line).join('\n'));
            };

            if (setting === 'labels') {
                await updateDotEnv('SCRYPTED_CLUSTER_LABELS', value.join(','));
            } else if (setting === 'name') {
                await updateDotEnv('SCRYPTED_CLUSTER_WORKER_NAME', value);
            }
            setTimeout(async () => {
                const serviceControl = await clusterFork.getServiceControl(worker.id);
                await serviceControl.restart().catch(() => { });
            }, 10000);
        });
    }

    async getReadmeMarkdown(): Promise<string> {
        return `Manage Scrypted's cluster mode. Run storage devices and compute services on separate servers.
        
[Read Documentation](https://docs.scrypted.app/maintenance/cluster.html).`;
    }
}
