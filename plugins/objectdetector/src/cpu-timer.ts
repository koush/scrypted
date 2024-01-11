import { CpuInfo, cpus } from 'os';

function getIdleTotal(cpu: CpuInfo) {
    const t = cpu.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    const idle = t.idle;
    return {
        idle,
        total,
    }
}

export class CpuTimer {
    previousSample: ReturnType<typeof cpus>;

    sample(): number {
        const sample = cpus();
        const previousSample = this.previousSample;
        this.previousSample = sample;

        // can cpu count change at runtime, who knows
        if (!previousSample || previousSample.length !== sample.length)
            return 0;

        const times = sample.map((v, i) => {
            const c = getIdleTotal(v);
            const p = getIdleTotal(previousSample[i]);
            const total = c.total - p.total;
            const idle = c.idle - p.idle;
            return 1 - idle / total;
        });

        const total = times.reduce((p, c) => p + c, 0);
        return total / sample.length;
    }
}
