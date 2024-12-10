import type { ClusterManager } from "@scrypted/types";
import type { PluginAPI } from "./plugin-api";
import type { ClusterForkService } from "../services/cluster-fork";

export class ClusterManagerImpl implements ClusterManager {
    private clusterServicePromise: Promise<ClusterForkService>;
    
    constructor(public clusterMode: undefined | 'client' | 'server', private api: PluginAPI, private clusterWorkerId: string) {
    }

    getClusterWorkerId(): string {
        return this.clusterWorkerId;
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
