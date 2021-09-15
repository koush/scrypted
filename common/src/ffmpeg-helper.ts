import { ChildProcess } from "child_process";

export function ffmpegLogInitialOutput(console: Console, cp: ChildProcess, forever?: boolean) {
    function logger(log: (str: string) => void): (buffer: Buffer) => void {
        const ret = (buffer: Buffer) => {
            const str = buffer.toString();
            if (!forever && (str.indexOf('frame=') !== -1 || str.indexOf('size=') !== -1)) {
                log(str);
                log('video/audio detected, discarding further input');
                cp.stdout.removeListener('data', ret);
                cp.stderr.removeListener('data', ret);
                return;
            }

            log(str);
        }

        return ret;
    };
    cp.stdout?.on('data', logger(console.log));
    cp.stderr?.on('data', logger(console.error));
}