import { ChildProcess } from "child_process";

export function ffmpegLogInitialOutput(console: Console, cp: ChildProcess) {
    function logger(log: (str: string) => void): (buffer: Buffer) => void {
        const ret = (buffer: Buffer) => {
            const str = buffer.toString();
            if (str.indexOf('frame=') !== -1) {
                log('frames detected, discarding further input');
                cp.stdout.removeListener('data', ret);
                cp.stderr.removeListener('data', ret);
                return;
            }

            log(buffer.toString());
        }

        return ret;
    };
    cp.stdout?.on('data', logger(console.log));
    cp.stderr?.on('data', logger(console.error));
}