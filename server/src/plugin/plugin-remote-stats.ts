import { NodeThreadWorker } from "./runtime/node-thread-worker";

export interface PluginStats {
    type: 'stats',
    cpu: NodeJS.CpuUsage;
    memoryUsage: NodeJS.MemoryUsage;
}

export function startStatsUpdater(allMemoryStats: Map<NodeThreadWorker, NodeJS.MemoryUsage>, updateStats: (stats: PluginStats) => void) {
    setInterval(() => {
        const cpuUsage = process.cpuUsage();
        allMemoryStats.set(undefined, process.memoryUsage());

        const memoryUsage: NodeJS.MemoryUsage = {
            rss: 0,
            heapTotal: 0,
            heapUsed: 0,
            external: 0,
            arrayBuffers: 0,
        }

        for (const mu of allMemoryStats.values()) {
            memoryUsage.rss += mu.rss;
            memoryUsage.heapTotal += mu.heapTotal;
            memoryUsage.heapUsed += mu.heapUsed;
            memoryUsage.external += mu.external;
            memoryUsage.arrayBuffers += mu.arrayBuffers;
        }

        updateStats({
            type: 'stats',
            cpu: cpuUsage,
            memoryUsage,
        });
    }, 10000);
}