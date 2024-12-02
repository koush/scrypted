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
    maxSpeed = 0;

    sample(): number {
        const sample = cpus();
        const previousSample = this.previousSample;
        this.previousSample = sample;

        // can cpu count change at runtime, who knows
        if (!previousSample || previousSample.length !== sample.length)
            return 0;

        // cpu may be throttled in low power mode, so observe total speed to scale
        let totalSpeed = 0;

        const times = sample.map((v, i) => {
            totalSpeed += v.speed;
            const c = getIdleTotal(v);
            const p = getIdleTotal(previousSample[i]);
            const total = c.total - p.total;
            const idle = c.idle - p.idle;
            return 1 - idle / total;
        });

        this.maxSpeed = Math.max(this.maxSpeed, totalSpeed);

        // will return a value between 0 and 1, where 1 is full cpu speed
        // the cpu usage is scaled by the clock speed
        // so if the cpu is running at 1ghz out of 3ghz, the cpu usage is scaled by 1/3
        const clockScale = totalSpeed / this.maxSpeed;

        const total = times.reduce((p, c) => p + c, 0);
        return total / sample.length * clockScale;
    }
}
