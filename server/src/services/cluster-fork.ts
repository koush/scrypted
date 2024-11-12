import { ForkOptions } from "@scrypted/types";
import { PluginRemoteLoadZipOptions, PluginZipAPI } from "../plugin/plugin-api";
import type { ScryptedRuntime } from "../runtime";
import { PeerLiveness, ClusterForkParam, matchesClusterLabels } from "../scrypted-cluster";

export class ClusterFork {
    constructor(public runtime: ScryptedRuntime) { }

    async fork(peerLiveness: PeerLiveness, options: ForkOptions, packageJson: any, zipAPI: PluginZipAPI, zipOptions: PluginRemoteLoadZipOptions) {
        const worker = [...this.runtime.clusterWorkers].find(worker => matchesClusterLabels);
        if (!worker)
            throw new Error(`no worker found for cluster labels ${options.labels}`);

        const fork: ClusterForkParam = await worker.peer.getParam('fork');
        return fork(peerLiveness, options, packageJson, zipAPI, zipOptions);
    }
}
