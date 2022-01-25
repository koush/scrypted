import { ChildProcess } from "child_process";
import { MediaStreamOptions, VideoCamera } from "@scrypted/sdk";


const filtered = [
    'decode_slice_header error',
    'no frame!',
    'non-existing PPS',
];

export function ffmpegLogInitialOutput(console: Console, cp: ChildProcess, forever?: boolean) {
    function logger(log: (str: string) => void): (buffer: Buffer) => void {
        const ret = (buffer: Buffer) => {
            const str = buffer.toString();

            for (const filter of filtered) {
                if (str.indexOf(filter) !== -1)
                    return;
            }

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
    cp.on('exit', () => console.log('ffmpeg exited'));
}

export async function probeVideoCamera(device: VideoCamera) {
    let options: MediaStreamOptions[];
    try {
      options = await device.getVideoStreamOptions() || [];
    }
    catch (e) {
    }

    // todo: uses the first stream to determine audio availability. buggy! fix this!
    const noAudio = options && options.length && options[0].audio === null;
    return {
        options,
        noAudio,
    };
}

export function safePrintFFmpegArguments(console: Console, args: string[]) {
    const ret = [];
    for (const arg of args) {
        try {
            const url = new URL(arg);
            if (url.password) {
                url.password = 'REDACTED';
                ret.push(url.toString());
            }
            else {
                ret.push(arg);
            }
        }
        catch (e) {
            ret.push(arg);
        }
    }

    console.log(ret.join(' '));
}
