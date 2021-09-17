import { ChildProcess } from "child_process";
import { MediaStreamOptions, VideoCamera } from "@scrypted/sdk";

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

export async function probeVideoCamera(device: VideoCamera) {
    let options: MediaStreamOptions[];
    try {
      options = await device.getVideoStreamOptions() || [];
    }
    catch (e) {
    }

    const noAudio = options && options.length && options[0].audio === null;
    return {
        options,
        noAudio,
    };
}
