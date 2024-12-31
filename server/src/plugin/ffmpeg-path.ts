import { getFfmpegPath } from '@scrypted/ffmpeg-static';
import fs from 'fs';
import os from 'os';

export async function getScryptedFFmpegPath(): Promise<string> {
    // try to get the ffmpeg path as a value of another variable
    // ie, in docker builds:
    //     export SCRYPTED_FFMPEG_PATH_ENV_VARIABLE=SCRYPTED_RASPBIAN_FFMPEG_PATH
    const v = process.env.SCRYPTED_FFMPEG_PATH_ENV_VARIABLE;
    if (v) {
        const f = process.env[v];
        if (f && fs.existsSync(f))
            return f;
    }

    // try to get the ffmpeg path from a variable
    // ie:
    //     export SCRYPTED_FFMPEG_PATH=/usr/local/bin/ffmpeg
    const f = process.env.SCRYPTED_FFMPEG_PATH;
    if (f && fs.existsSync(f))
        return f;

    const defaultPath = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    return getFfmpegPath() || defaultPath;
}
