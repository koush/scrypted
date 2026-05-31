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

    // strange behavior on synology and possibly unraid
    // where environment variables are not necessarily kept
    // in their container manager thing.
    // so even if the Dockerfile sets SCRYPTED_FFMPEG_PATH,
    // it is not gauranteed to be present in the environment.
    // this causes issues with @scrypted/ffmpeg-static,
    // which looks at that environment variable at build time
    // to determine whether to install ffmpeg.

    // try to get the ffmpeg path from a variable
    // ie:
    //     export SCRYPTED_FFMPEG_PATH=/usr/local/bin/ffmpeg
    const f = process.env.SCRYPTED_FFMPEG_PATH;
    if (f && fs.existsSync(f))
        return f;

    const defaultPath = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const scryptedFfmpegStatic = getFfmpegPath();
    if (scryptedFfmpegStatic && fs.existsSync(scryptedFfmpegStatic))
        return scryptedFfmpegStatic;
    return defaultPath;
}
