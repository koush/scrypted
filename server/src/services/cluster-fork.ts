import { ClusterFork, ClusterWorker } from "@scrypted/types";
import fs from 'fs';
import { matchesClusterLabels } from "../cluster/cluster-labels";
import type { RuntimeWorkerOptions } from "../plugin/runtime/runtime-worker";
import { RpcPeer } from "../rpc";
import type { ScryptedRuntime } from "../runtime";
import type { ClusterForkOptions, ClusterForkParam, ClusterForkResultInterface, PeerLiveness, RunningClusterWorker } from "../scrypted-cluster-main";
import { removeIPv4EmbeddedIPv6 } from "../ip";

class WrappedForkResult implements ClusterForkResultInterface {
    [RpcPeer.PROPERTY_PROXY_PROPERTIES] = {
        clusterWorkerId: undefined as string,
    };

    constructor(public clusterWorkerId: string, public forkResult: Promise<ClusterForkResultInterface>) {
        this[RpcPeer.PROPERTY_PROXY_PROPERTIES].clusterWorkerId = clusterWorkerId;
    }

    async kill() {
        const fr = await this.forkResult.catch(() => { });
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
        let matchingWorkers = [...this.runtime.clusterWorkers.entries()].map(([id, worker]) => ({
            worker,
            matches: matchesClusterLabels(options, worker.labels),
        }))
            .filter(({ matches, worker }) => {
                // labels must match
                // and worker id must match if provided
                return matches && (!options.clusterWorkerId || worker.id === options.clusterWorkerId);
            });

        let worker: RunningClusterWorker;

        // try to keep fork id affinity to single worker if present. this presents the opportunity for
        // IPC.
        if (options.id)
            worker = matchingWorkers.find(({ worker }) => [...worker.forks].find(f => f.id === options.id))?.worker;

        if (!worker) {
            // sort by number of matches, to find the best match.
            matchingWorkers.sort((a, b) => b.matches - a.matches);

            const bestMatch = matchingWorkers[0];

            if (!bestMatch) {
                if (options.clusterWorkerId)
                    throw new Error(`no worker found for cluster id ${options.clusterWorkerId}`);
                throw new Error(`no worker found for cluster labels ${JSON.stringify(options.labels)}`);
            }

            // filter out workers that are not equivalent to the best match.
            // this enforces the "prefer" label.
            matchingWorkers = matchingWorkers.filter(({ matches }) => matches === bestMatch.matches)
                // sort by number of forks, to distribute load.
                .sort((a, b) => a.worker.forks.size * a.worker.weight - b.worker.forks.size * b.worker.weight);

            worker = matchingWorkers[0]?.worker;
        }

        console.log('forking to worker', worker.id, options);

        worker.fork ||= worker.peer.getParam('fork');
        const fork: ClusterForkParam = await worker.fork;

        const forkResultPromise = fork(options.runtime, runtimeWorkerOptions, peerLiveness, getZip);
        options.id ||= this.runtime.findPluginDevice(runtimeWorkerOptions.packageJson.name)?._id;

        // the server is responsible for killing the forked process when the requestor is killed.
        // minimizes lifecycle management duplication in python and node.
        worker.forks.add(options);
        peerLiveness.waitKilled().catch(() => { }).finally(() => {
            forkResultPromise.then(forkResult => forkResult.kill().catch(() => { }));
        });
        forkResultPromise.then(forkResult => {
            forkResult.clusterWorkerId = worker.id;
            forkResult.waitKilled().catch(() => { }).finally(() => {
                worker.forks.delete(options);
            });
        });

        const ret: ClusterForkResultInterface = new WrappedForkResult(worker.id, forkResultPromise);
        return ret;
    };

    async getClusterWorkers(): Promise<Record<string, ClusterWorker>> {
        const ret: Record<string, ClusterWorker> = {};
        for (const worker of this.runtime.clusterWorkers.values()) {
            ret[worker.id] = {
                id: worker.id,
                name: worker.name,
                labels: worker.labels,
                forks: [...worker.forks] as ClusterFork[],
                mode: worker.mode,
                address: removeIPv4EmbeddedIPv6(worker.address),
            };
        }
        return ret;
    }

    async getParam(clusterWorkerId: string, key: string) {
        const clusterWorker = this.runtime.clusterWorkers.get(clusterWorkerId);
        return clusterWorker.peer.getParam(key);
    }

    async getFsPromises(clusterWorkerId: string) {
        const clusterWorker = this.runtime.clusterWorkers.get(clusterWorkerId);
        if (clusterWorker.mode === 'server') {
            return {
                [RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN]: true,
                ...fs.promises,
            };
        }
        return clusterWorker.peer.getParam('fs.promises');
    }

    async getEnvControl(clusterWorkerId: string) {
        const clusterWorker = this.runtime.clusterWorkers.get(clusterWorkerId);
        if (clusterWorker.mode === 'server')
            return this.runtime.envControl;
        return clusterWorker.peer.getParam('env-control');
    }

    async getServiceControl(clusterWorkerId: string) {
        const clusterWorker = this.runtime.clusterWorkers.get(clusterWorkerId);
        if (clusterWorker.mode === 'server')
            return this.runtime.serviceControl;
        return clusterWorker.peer.getParam('service-control');
    }

    async getInfo(clusterWorkerId: string) {
        const clusterWorker = this.runtime.clusterWorkers.get(clusterWorkerId);
        if (clusterWorker.mode === 'server')
            return this.runtime.info;
        return clusterWorker.peer.getParam('info');
    }
}
