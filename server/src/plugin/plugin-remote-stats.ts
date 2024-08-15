import { RuntimeWorker } from "./runtime/runtime-worker";

export interface PluginStats {
    type: 'stats',
    cpu: NodeJS.CpuUsage;
    memoryUsage: NodeJS.MemoryUsage;
}

export function startStatsUpdater(allMemoryStats: Map<RuntimeWorker, NodeJS.MemoryUsage>, updateStats: (stats: PluginStats) => void) {
    setInterval(() => {
        let cpuUsage: NodeJS.CpuUsage;
        let memoryUsage: NodeJS.MemoryUsage;
        if (process.cpuUsage)
            cpuUsage = process.cpuUsage();

        allMemoryStats.set(undefined, process.memoryUsage());

        memoryUsage = {
            rss: 0,
            heapTotal: 0,
            heapUsed: 0,
            external: 0,
            arrayBuffers: 0,
        }

        for (const mu of allMemoryStats.values()) {
            if (!mu)
                continue;
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
