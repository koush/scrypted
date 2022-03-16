import sdk, { FFMpegInput, MediaObject, MixinDeviceBase, MixinDeviceOptions, VideoCamera, VideoClip, VideoClipOptions, VideoClips } from "@scrypted/sdk";
import fs from 'fs';
import { getCameraRecordingFiles, getVideoClips, HKSV_MIME_TYPE, parseHksvId, removeVideoClip } from "./types/camera/camera-recording-files";

const { mediaManager } = sdk;

export class ClipsMixin extends MixinDeviceBase<VideoCamera> implements VideoClips {
    constructor(options: MixinDeviceOptions<VideoCamera>) {
        super(options);
    }

    async getVideoClips(options?: VideoClipOptions): Promise<VideoClip[]> {
        let ret = await getVideoClips(this.id);
        ret = ret.sort((a, b) => a.startTime - b.startTime);

        if (options?.startTime) {
            const startIndex = ret.findIndex(c => c.startTime > options.startTime);
            ret = ret.slice(startIndex);
        }

        if (options?.endTime)
            ret = ret.filter(clip => clip.startTime + clip.duration < options.endTime);

        if (options?.reverseOrder)
            ret = ret.reverse();

        if (options?.startId) {
            const startIndex = ret.findIndex(c => c.id === options.startId);
            if (startIndex === -1)
                throw new Error('startIndex not found');
            ret = ret.slice(startIndex);
        }

        if (options?.count)
            ret = ret.slice(0, options.count);

        return ret;
    }

    getVideoClip(videoClipId: string): Promise<MediaObject> {
        parseHksvId(videoClipId);
        return mediaManager.createMediaObject(Buffer.from(videoClipId), HKSV_MIME_TYPE);
    }

    async getVideoClipThumbnail(videoClipId: string): Promise<MediaObject> {
        const { id, startTime } = parseHksvId(videoClipId);
        const { mp4Path, thumbnailPath } = await getCameraRecordingFiles(id, startTime);
        let jpeg: Buffer;
        if (fs.existsSync(thumbnailPath)) {
            jpeg = fs.readFileSync(thumbnailPath);
        }
        else {
            const ffmpegInput: FFMpegInput = {
                url: undefined,
                inputArguments: [
                    '-ss', '00:00:04',
                    '-i', mp4Path,
                ],
            };
            const input = await mediaManager.createFFmpegMediaObject(ffmpegInput);
            jpeg = await mediaManager.convertMediaObjectToBuffer(input, 'image/jpeg');
            fs.writeFileSync(thumbnailPath, jpeg);
        }
        return mediaManager.createMediaObject(jpeg, 'image/jpeg');
    }

    async removeVideoClips(...ids: string[]): Promise<void> {
        if (!ids.length) {
            const allClips = await getVideoClips(this.id);
            ids = allClips.map(clip => clip.id);
        }
        for (const id of ids) {
            removeVideoClip(id);
        }
    }
}
