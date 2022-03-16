import { VideoClips } from "@scrypted/types";
import { ScryptedMimeTypes } from "@scrypted/types";
import { MediaManager } from "@scrypted/types";
import { VideoClip } from "@scrypted/types";
import { createBlobUrl } from "./camera";

export async function fetchClipThumbnail(mediaManager: MediaManager, device: VideoClips, clip: VideoClip) {
    const mo = await device.getVideoClipThumbnail(clip.id);
    // const buffer = await mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg');
    // const blob = new Blob([buffer], 'image/jpeg');
    return createBlobUrl(mediaManager, mo);
}

export async function fetchClipUrl(mediaManager: MediaManager, device: VideoClips, clip: VideoClip) {
    const mo = await device.getVideoClip(clip.id);
    try {
        const url = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.LocalUrl);
        return url.toString();
    }
    catch (e) {
        console.error('explicit conversion to local url failed. trying implicit.', e);
    }

    const url = await mediaManager.convertMediaObjectToLocalUrl(mo, 'video/*');
    console.log(url);
    return url;
}
