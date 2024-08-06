import sdk, { MediaObject, Readme, ScryptedDeviceBase, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoClip, VideoClipOptions, VideoClips } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import checkDiskSpace from 'check-disk-space';
import { getSavePath, getVideoClip, getVideoClips, getVideoClipThumbnail, nukeClips, parseHksvId, pruneClips, removeVideoClip } from "./types/camera/camera-recording-files";

const DAYS_TO_KEEP = 3;
const PRUNE_AGE = DAYS_TO_KEEP * 24 * 60 * 60 * 1000;
const { systemManager } = sdk;

export class VideoClipsMixinProvider extends ScryptedDeviceBase implements Settings, Readme, VideoClips {
    storageSettings = new StorageSettings(this, {
        reset: {
            title: 'Remove All Clips',
            description: 'Type REMOVE to confirm clearing all clips from Scrypted storage.',
            placeholder: 'REMOVE',
            onPut() {
                nukeClips();
            },
            mapPut() {
            }
        }
    });

    pruneInterval: NodeJS.Timeout;

    constructor(nativeId?: string) {
        super(nativeId);

        this.fromMimeType = 'x-scrypted-homekit/x-hksv';
        this.toMimeType = ScryptedMimeTypes.MediaObject;

        this.prune();
    }

    resetPruneInterval() {
        clearTimeout(this.pruneInterval);
        this.pruneInterval = setInterval(() => {
            this.prune();
        }, 60 * 60 * 1000);
    }

    async getVideoClips(options?: VideoClipOptions): Promise<VideoClip[]> {
        const clips = await getVideoClips(options);
        for (const clip of clips) {
            const { id } = parseHksvId(clip.id);
            clip.description = systemManager.getDeviceById(id)?.name;
        }
        return clips;
    }

    getVideoClip(videoClipId: string): Promise<MediaObject> {
        return getVideoClip(videoClipId);
    }

    getVideoClipThumbnail(videoClipId: string): Promise<MediaObject> {
        return getVideoClipThumbnail(videoClipId);
    }

    async removeVideoClips(...videoClipIds: string[]) {
        if (!videoClipIds.length) {
            const allClips = await getVideoClips(undefined, this.id);
            videoClipIds = allClips.map(clip => clip.id);
        }
        for (const id of videoClipIds) {
            await removeVideoClip(id);
        }

        this.onDeviceEvent(ScryptedInterface.VideoClips, undefined);
    }

    async prune() {
        const savePath = await getSavePath();

        const diskSpace = await checkDiskSpace(savePath);
        let pruneAge = PRUNE_AGE;
        if (diskSpace.free < 10_000_000_000) {
            pruneAge = 1 * 60 * 60 * 1000;
            this.console.warn(`Low Disk space: ${savePath}`);
            this.console.warn("Pruning videos older than 1 hour to recover space.");
        }

        pruneClips(pruneAge, this.console);
    }

    async getReadmeMarkdown(): Promise<string> {
        return "# HomeKit Secure Video Local Copy\n\nThis extension will save your HomeKit Secure Video Clips for local review in Scrypted.";
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }
}
