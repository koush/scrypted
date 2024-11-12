import { ForkOptions } from "@scrypted/types";
import { PluginRemoteLoadZipOptions } from "../plugin/plugin-api";
import type { ScryptedRuntime } from "../runtime";
import { ClusterForkParam, matchesClusterLabels } from "../scrypted-cluster";

export class ClusterFork {
    constructor(public runtime: ScryptedRuntime) { }

    async fork(options: ForkOptions, packageJson: any, getZip: () => Promise<Buffer>, zipOptions: PluginRemoteLoadZipOptions) {
        const worker = [...this.runtime.clusterWorkers].find(worker => matchesClusterLabels);
        if (!worker) 
            throw new Error(`no worker found for cluster labels ${options.labels}`);

        const fork: ClusterForkParam = await worker.peer.getParam('fork');
        return fork(options, packageJson, getZip, zipOptions);
    }
}
