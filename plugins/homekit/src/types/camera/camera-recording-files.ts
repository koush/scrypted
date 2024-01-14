
import sdk, { FFmpegInput, MediaObject, VideoClip, VideoClipOptions } from '@scrypted/sdk';
import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

const { mediaManager } = sdk;
export const VIDEO_CLIPS_NATIVE_ID = 'save-video-clips';

export interface HksvVideoClip extends VideoClip {
    fragments: number;
}

export async function nukeClips() {
    const savePath = await getSavePath();
    await fs.promises.rm(savePath, { recursive: true, force: true });
}

export async function pruneClips(pruneAge: number, console: Console) {
    const savePath = await getSavePath();
    const allFiles = await fs.promises.readdir(savePath);
    const jsonFiles = allFiles.filter(file => file.endsWith('.json'));

    const now = Date.now();
    const pruneBefore = now - pruneAge;
    // watch for weird clock changes too.
    const pruneAfter = now + (24 * 60 * 60 * 1000);

    let retained = 0;
    let removedSize = 0;
    let retainedSize = 0;
    for (const jsonFile of jsonFiles) {
        const hksvId = jsonFile.slice(0, -'.json'.length);
        let size = 0;
        try {
            const { id, startTime } = parseHksvId(hksvId);
            try {
                const { mp4Path } = await getCameraRecordingFiles(id, startTime);
                const stat = await fs.promises.stat(mp4Path);
                size += stat.size;
            }
            catch (e) {
            }

            if (startTime < pruneBefore)
                throw new Error("Pruning old clip");
            if (!startTime)
                throw new Error("Pruning invalid start time");
            if (startTime > pruneAfter)
                throw new Error("Pruning weird future clip");
            retained++;
            retainedSize += size;
        }
        catch (e) {
            removedSize += size;
            console.log('removing video clip', hksvId);
            removeVideoClip(hksvId);
        }
    }

    console.log(`Removed Recordings: ${jsonFiles.length - retained}: ${removedSize} bytes.`);
    console.log(`Retained Recordings: ${retained}: ${retainedSize} bytes.`);
}

export async function getSavePath() {
    const savePath = path.join(await mediaManager.getFilesPath(), 'hksv');
    await mkdirp(savePath);
    return savePath;
}

export async function getVideoClips(options?: VideoClipOptions, id?: string): Promise<HksvVideoClip[]> {
    const savePath = await getSavePath();
    const allFiles = await fs.promises.readdir(savePath);
    const jsonFiles = allFiles.filter(file => file.endsWith('.json'));
    let idJsonFiles = jsonFiles;
    if (id)
        idJsonFiles = jsonFiles.filter(file => file.startsWith(`${id}-`));
    let ret: HksvVideoClip[] = [];

    for (const jsonFile of idJsonFiles) {
        try {
            const jsonFilePath = path.join(savePath, jsonFile);
            const json: HksvVideoClip = JSON.parse((await fs.promises.readFile(jsonFilePath)).toString());
            ret.push(json);
        }
        catch (e) {
        }
    }

    ret = ret.sort((a, b) => a.startTime - b.startTime);

    if (options?.startTime) {
        const startIndex = ret.findIndex(c => c.startTime > options.startTime);
        if (startIndex === -1)
            return [];
    }

    if (options?.endTime)
        ret = ret.filter(clip => clip.startTime + clip.duration < options.endTime);

    if (options?.count)
        ret = ret.slice(0, options.count);

    return ret;
}

export async function getCameraRecordingFiles(id: string, startTime: number) {
    const savePath = await getSavePath();

    const clipId = `${id}-${startTime}`;
    const metadataPath = path.join(savePath, `${clipId}.json`);
    const mp4Name = `${clipId}.mp4`;
    const mp4Path = path.join(savePath, mp4Name);
    const thumbnailPath = path.join(savePath, `${clipId}.jpg`);
    return {
        clipId,
        savePath,
        metadataPath,
        mp4Name,
        mp4Path,
        thumbnailPath,
    }
}

export function parseHksvId(hksvId: string) {
    const [id, st] = hksvId.split('-');
    // if (!systemManager.getDeviceById(id))
    //     throw new Error('unknown device ' + id);
    const startTime = parseInt(st);
    // if (!startTime)
    //     throw new Error('unknown startTime ' + st);
    return {
        id,
        startTime,
    };
}

async function unlinkSafe(...files: string[]) {
    for (const f of files) {
        try {
            await fs.promises.unlink(f);
        }
        catch (e) {
        }
    }
}

export async function removeVideoClip(hksvId: string) {
    try {
        const { id, startTime } = parseHksvId(hksvId);
        const {
            mp4Path,
            thumbnailPath,
            metadataPath
        } = await getCameraRecordingFiles(id, startTime);
        await unlinkSafe(mp4Path, thumbnailPath, metadataPath);
    }
    catch (e) {
    }
}

export async function getVideoClipThumbnail(videoClipId: string): Promise<MediaObject> {
    const { id, startTime } = parseHksvId(videoClipId);
    const { mp4Path, thumbnailPath } = await getCameraRecordingFiles(id, startTime);
    let jpeg: Buffer;
    try {
        jpeg = await fs.promises.readFile(thumbnailPath);
    }
    catch (e) {

    }
    if (!jpeg) {
        const ffmpegInput: FFmpegInput = {
            url: undefined,
            inputArguments: [
                '-ss', '00:00:04',
                '-i', mp4Path,
            ],
        };
        const input = await mediaManager.createFFmpegMediaObject(ffmpegInput);
        jpeg = await mediaManager.convertMediaObjectToBuffer(input, 'image/jpeg');
        await fs.promises.writeFile(thumbnailPath, jpeg);
    }
    const url = `file:${thumbnailPath}`;
    return mediaManager.createMediaObjectFromUrl(url);
}

export async function getVideoClip(videoClipId: string): Promise<MediaObject> {
    const { id, startTime } = parseHksvId(videoClipId);
    const { mp4Path } = await getCameraRecordingFiles(id, startTime);
    const url = `file:${mp4Path}`;
    return mediaManager.createMediaObjectFromUrl(url);
}
