import os from 'os';

let totalGigahertz = 0;

export function getMaxConcurrentObjectDetectionSessions() {
    const cpus = os.cpus();

    // apple silicon cpu.speed is incorrect, and can handle quite a bit due to
    // gpu decode and neural core usage.
    // .5 detect per cpu is a conservative guess. so an m1 ultra would handle 10
    // simultaneous camera detections.
    // apple silicon also reports cpu speed as 24 mhz, so the following code would
    // fail anyways.
    if (process.platform === 'darwin' && process.arch === 'arm64')
        return cpus.length * .5;

    let speed = 0;
    for (const cpu of cpus) {
        // can cpu speed be zero? is that a thing?
        speed += cpu.speed || 600;
    }

    totalGigahertz = Math.max(speed, totalGigahertz);

    // a wyse 5070 self reports in description as 1.5ghz and has 4 cores and can comfortably handle
    // two 2k detections at the same time.
    // the speed reported while detecting caps at 2500, presumably due to burst?
    // the total mhz would be 10000 in this case.
    // observed idle per cpu speed is 800.
    // not sure how hyperthreading plays into this.
    return Math.max(2, totalGigahertz / 4000);
}
