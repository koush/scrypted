import type { ScryptedRuntime } from "../runtime";
import { matchesClusterLabels } from "../cluster/cluster-labels";
import { ClusterForkOptions, ClusterForkParam, ClusterWorker, PeerLiveness } from "../scrypted-cluster-main";

export class ClusterFork {
    constructor(public runtime: ScryptedRuntime) { }

    async fork(peerLiveness: PeerLiveness, options: ClusterForkOptions, packageJson: any, zipHash: string, getZip: () => Promise<Buffer>) {
        const matchingWorkers = [...this.runtime.clusterWorkers.values()].map(worker => ({
            worker,
            matches: matchesClusterLabels(options, worker.labels),
        }))
            .filter(({ matches }) => matches);
        matchingWorkers.sort((a, b) => b.worker.labels.length - a.worker.labels.length);

        let worker: ClusterWorker;

        // try to keep fork id affinity to single worker if present. this presents the opportunity for
        // IPC.
        if (options.id)
            worker = matchingWorkers.find(({ worker }) => [...worker.forks].find(f => f.id === options.id))?.worker;

        // TODO: round robin?
        worker ||= matchingWorkers[0]?.worker;

        if (!worker)
            throw new Error(`no worker found for cluster labels ${JSON.stringify(options.labels)}`);

        const fork: ClusterForkParam = await worker.peer.getParam('fork');
        const forkResult = await fork(peerLiveness, options.runtime, packageJson, zipHash, getZip);
        worker.forks.add(options);
        forkResult.waitKilled().catch(() => { }).finally(() => {
            worker.forks.delete(options);
        });
        return forkResult;
    }

    async getClusterWorkers() {
        const ret: any = {};
        for (const worker of this.runtime.clusterWorkers.values()) {
            ret[worker.id] = {
                labels: worker.labels,
                forks: [...worker.forks],
            };
        }
        return ret;
    }
}
