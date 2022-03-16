
import sdk, { VideoClip } from '@scrypted/sdk';
import path from 'path';
import fs from 'fs';

const { mediaManager } = sdk;

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
    return savePath;
}

export async function getVideoClips(id: string): Promise<HksvVideoClip[]> {
    const savePath = await getSavePath();
    const allFiles = await fs.promises.readdir(savePath);
    const jsonFiles = allFiles.filter(file => file.endsWith('.json'));
    const idJsonFiles = jsonFiles.filter(file => file.startsWith(`${id}-`));
    const ret: HksvVideoClip[] = [];

    for (const jsonFile of idJsonFiles) {
        try {
            const jsonFilePath = path.join(savePath, jsonFile);
            const json: HksvVideoClip = JSON.parse(fs.readFileSync(jsonFilePath).toString());
            ret.push(json);
        }
        catch (e) {
        }
    }

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
        unlinkSafe(mp4Path, thumbnailPath, metadataPath);
    }
    catch (e) {
    }
}
