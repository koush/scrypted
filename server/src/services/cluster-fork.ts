import { matchesClusterLabels } from "../cluster/cluster-labels";
import type { ScryptedRuntime } from "../runtime";
import type { ClusterForkOptions, ClusterForkParam, PeerLiveness, RunningClusterWorker } from "../scrypted-cluster-main";

export class ClusterForkService {
    constructor(public runtime: ScryptedRuntime) { }

    async fork(peerLiveness: PeerLiveness, options: ClusterForkOptions, packageJson: any, zipHash: string, getZip: () => Promise<Buffer>) {
        const matchingWorkers = [...this.runtime.clusterWorkers.entries()].map(([id, worker]) => ({
            worker,
            matches: matchesClusterLabels(options, worker.labels),
        }))
            .filter(({ matches, worker }) => {
                // labels must match
                // and worker id must match if provided
                return matches && (!options.clusterWorkerId || worker.id === options.clusterWorkerId);
            });
        matchingWorkers.sort((a, b) => b.worker.labels.length - a.worker.labels.length);

        let worker: RunningClusterWorker;

        // try to keep fork id affinity to single worker if present. this presents the opportunity for
        // IPC.
        if (options.id)
            worker = matchingWorkers.find(({ worker }) => [...worker.forks].find(f => f.id === options.id))?.worker;

        // TODO: round robin?
        worker ||= matchingWorkers[0]?.worker;

        if (!worker) {
            if (options.clusterWorkerId)
                throw new Error(`no worker found for cluster id ${options.clusterWorkerId}`);
            throw new Error(`no worker found for cluster labels ${JSON.stringify(options.labels)}`);
        }

        const fork: ClusterForkParam = await worker.peer.getParam('fork');
        const forkResult = await fork(peerLiveness, options.runtime, packageJson, zipHash, getZip);
        options.id ||= this.runtime.findPluginDevice(packageJson.name)?._id;
        worker.forks.add(options);
        forkResult.waitKilled().catch(() => { }).finally(() => {
            worker.forks.delete(options);
        });

        forkResult.clusterWorkerId = worker.id;
        return forkResult;
    }

    async getClusterWorkers() {
        const ret: any = {};
        for (const worker of this.runtime.clusterWorkers.values()) {
            ret[worker.id] = {
                name: worker.peer.peerName,
                labels: worker.labels,
                forks: [...worker.forks],
            };
        }
        return ret;
    }
}
