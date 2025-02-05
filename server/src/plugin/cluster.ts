import type { ClusterManager, ClusterWorker } from "@scrypted/types";
import type { PluginAPI } from "./plugin-api";

export interface ClusterForkServiceInterface {
    getClusterWorkers(): Promise<Record<string, ClusterWorker>>;
}

export class ClusterManagerImpl implements ClusterManager {
    private clusterServicePromise: Promise<ClusterForkServiceInterface>;
    
    constructor(public clusterMode: undefined | 'client' | 'server', private api: PluginAPI, private clusterWorkerId: string) {
    }

    getClusterWorkerId(): string {
        return this.clusterWorkerId;
    }

    getClusterAddress(): string {
        return process.env.SCRYPTED_CLUSTER_ADDRESS;
    }

    getClusterMode(): 'server' | 'client' | undefined {
        return this.clusterMode;
    }

    async getClusterWorkers() {
        const clusterFork = await this.getClusterService();
        return clusterFork.getClusterWorkers();
    }

    private getClusterService() {
        this.clusterServicePromise ||= this.api.getComponent('cluster-fork');
        return this.clusterServicePromise;
    }
}
