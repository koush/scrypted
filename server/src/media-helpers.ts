import { ChildProcess } from "child_process";
import process from 'process';

const filtered = [
    'decode_slice_header error',
    'no frame!',
    'non-existing PPS',
];

export function safeKillFFmpeg(cp: ChildProcess) {
    if (!cp)
        return;
    // this will allow ffmpeg to send rtsp TEARDOWN etc
    try {
        cp.stdin.write('q\n');
    }
    catch (e) {
    }
    setTimeout(() => {
        cp.kill();
        setTimeout(() => {
            cp.kill('SIGKILL');
        }, 2000);
    }, 2000);
}

export function ffmpegLogInitialOutput(console: Console, cp: ChildProcess, forever?: boolean, storage?: Storage) {
    const SCRYPTED_FFMPEG_NOISY = !!process.env.SCRYPTED_FFMPEG_NOISY || !!storage?.getItem('SCRYPTED_FFMPEG_NOISY');

    function logger(log: (str: string) => void): (buffer: Buffer) => void {
        const ret = (buffer: Buffer) => {
            const str = buffer.toString();

            for (const filter of filtered) {
                if (str.indexOf(filter) !== -1)
                    return;
            }

            if (!SCRYPTED_FFMPEG_NOISY && !forever && (str.indexOf('frame=') !== -1 || str.indexOf('size=') !== -1)) {
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
    cp.on('exit', () => console.log('ffmpeg exited'));
}

export function safePrintFFmpegArguments(console: Console, args: string[]) {
    const ret = [];
    let redactNext = false;
    for (const arg of args) {
        try {
            if (redactNext) {
                const url = new URL(arg);
                ret.push(`${url.protocol}[REDACTED]`)
            }
            else {
                ret.push(arg);
            }
        }
        catch (e) {
            ret.push(arg);
        }

        // input arguments may contain passwords.
        redactNext = arg === '-i';
    }

    console.log(ret.join(' '));
}
