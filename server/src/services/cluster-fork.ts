import type { ScryptedRuntime } from "../runtime";
import { ClusterForkOptions, ClusterForkParam, matchesClusterLabels, PeerLiveness } from "../scrypted-cluster";

export class ClusterFork {
    constructor(public runtime: ScryptedRuntime) { }

    async fork(peerLiveness: PeerLiveness, options: ClusterForkOptions, packageJson: any, zipHash: string, getZip: () => Promise<Buffer>) {
        const matchingWorkers = [...this.runtime.clusterWorkers].map(worker => ({
            worker,
            matches: matchesClusterLabels(options, worker.labels),
        }))
        .filter(({ matches }) => matches);
        matchingWorkers.sort((a, b) => b.worker.labels.length - a.worker.labels.length);
        const worker = matchingWorkers[0]?.worker;

        if (!worker)
            throw new Error(`no worker found for cluster labels ${JSON.stringify(options.labels)}`);

        const fork: ClusterForkParam = await worker.peer.getParam('fork');
        return fork(peerLiveness, options.runtime, packageJson, zipHash, getZip);
    }

    async getClusterWorkers() {
        const ret: any = {};
        for (const worker of this.runtime.clusterWorkers) {
            ret[worker.peer.peerName] = {
                labels: worker.labels,
            };
        }
        return ret;
    }
}
