
import sdk, { VideoClip } from '@scrypted/sdk';
import path from 'path';
import fs from 'fs';
import checkDiskSpace from 'check-disk-space';

const { mediaManager, systemManager } = sdk;

export const HKSV_MIME_TYPE = 'x-scrypted-homekit/x-hksv';

export interface HksvVideoClip extends VideoClip {
    fragments: number;
}

const PRUNE_AGE = 24 * 60 * 60 * 1000;

export async function pruneClips() {
    const savePath = await getSavePath();
    const allFiles = await fs.promises.readdir(savePath);
    const jsonFiles = allFiles.filter(file => file.endsWith('.json'));

    const now = Date.now();
    const pruneBefore = now - PRUNE_AGE;
    // watch for weird clock changes too.
    const pruneAfter = now + PRUNE_AGE;

    for (const jsonFile of jsonFiles) {
        const hksvId = jsonFile.slice(0, '.json'.length);
        try {
            const { startTime } = parseHksvId(hksvId);
            if (startTime < pruneBefore)
                throw new Error("Pruning old clip");
            if (!startTime)
                throw new Error("Pruning invalid start time");
            if (startTime > pruneAfter)
                throw new Error("Pruning weird future clip");
        }
        catch (e) {
            console.error('removing video clip', hksvId);
            // removeVideoClip(hksvId);
        }
    }
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

export async function removeVideoClip(hksvId: string) {
    try {
        const { id, startTime } = parseHksvId(hksvId);
        const {
            mp4Path,
            metadataPath
        } = await getCameraRecordingFiles(id, startTime);
        try {
            fs.unlinkSync(mp4Path);
        }
        catch (e) {
        }
        try {
            fs.unlinkSync(metadataPath);
        }
        catch (e) {
        }
    }
    catch (e) {
    }
}
