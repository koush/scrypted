import { matchesClusterLabels } from "../cluster/cluster-labels";
import type { RuntimeWorkerOptions } from "../plugin/runtime/runtime-worker";
import { RpcPeer } from "../rpc";
import type { ScryptedRuntime } from "../runtime";
import type { ClusterForkOptions, ClusterForkParam, ClusterForkResultInterface, PeerLiveness, RunningClusterWorker } from "../scrypted-cluster-main";

class WrappedForkResult implements ClusterForkResultInterface {
    [RpcPeer.PROPERTY_PROXY_PROPERTIES] = {
        clusterWorkerId: undefined as string,
    };

    constructor(public clusterWorkerId: string, public forkResult: Promise<ClusterForkResultInterface>) {
        this[RpcPeer.PROPERTY_PROXY_PROPERTIES].clusterWorkerId = clusterWorkerId;
    }

    async kill() {
        const fr = await this.forkResult.catch(() => {});
        if (!fr)
            return;
        await fr.kill();
    }

    async getResult() {
        const fr = await this.forkResult;
        return fr.getResult();
    }

    async waitKilled() {
        const fr = await this.forkResult;
        await fr.waitKilled();
    }
}

export class ClusterForkService {
    constructor(public runtime: ScryptedRuntime) { }

    async fork(runtimeWorkerOptions: RuntimeWorkerOptions, options: ClusterForkOptions, peerLiveness: PeerLiveness, getZip: () => Promise<Buffer>) {
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
        const forkResultPromise = fork(options.runtime, runtimeWorkerOptions, peerLiveness, getZip);

        options.id ||= this.runtime.findPluginDevice(runtimeWorkerOptions.packageJson.name)?._id;
        worker.forks.add(options);

        forkResultPromise.then(forkResult => {
            forkResult.clusterWorkerId = worker.id;
            forkResult.waitKilled().catch(() => { }).finally(() => {
                worker.forks.delete(options);
            })
        });

        const ret: ClusterForkResultInterface = new WrappedForkResult(worker.id, forkResultPromise);
        return ret;
    };

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
