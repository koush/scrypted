import sdk, { MediaObject, MixinProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoClip, VideoClipOptions, VideoClips } from "@scrypted/sdk";
import { canCameraMixin } from "./camera-mixin";
import { HOMEKIT_MIXIN } from "./homekit-mixin";
import { StorageSettings } from "@scrypted/common/src/settings";
import { getSavePath, getVideoClip, getVideoClips, getVideoClipThumbnail, nukeClips, parseHksvId, pruneClips, removeVideoClip } from "./types/camera/camera-recording-files";
import { ClipsMixin } from "./video-clips-mixin";
import checkDiskSpace from 'check-disk-space';

const DAYS_TO_KEEP = 10;
const PRUNE_AGE = DAYS_TO_KEEP * 24 * 60 * 60 * 1000;
const { systemManager } = sdk;

export class VideoClipsMixinProvider extends ScryptedDeviceBase implements MixinProvider, Settings, Readme, VideoClips {
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

    pruneInterval = setInterval(() => {
        this.prune();
    }, 60 * 60 * 1000);

    constructor(nativeId?: string) {
        super(nativeId);

        this.fromMimeType = 'x-scrypted-homekit/x-hksv';
        this.toMimeType = ScryptedMimeTypes.MediaObject;

        this.prune();
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
            removeVideoClip(id);
        }
    }

    async prune() {
        const savePath = await getSavePath();

        const diskSpace = await checkDiskSpace(savePath);
        let pruneAge = PRUNE_AGE;
        if (diskSpace.free < 10_000_000_000) {
            pruneAge = 1 * 24 * 60 * 60 * 1000;
            this.console.warn(`Low Disk space: ${savePath}`);
            this.console.warn("Pruning videos older than 1 day to recover space.");
            this.log.a('Low disk space.');
        }

        pruneClips(pruneAge, this.console);
    }

    async getReadmeMarkdown(): Promise<string> {
        return "# Save HomeKit Video Clips\n\nThis extension will save your HomeKit Secure Video Clips for local review in Scrypted.";
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (canCameraMixin(type, interfaces) && interfaces.includes(HOMEKIT_MIXIN)) {
            return [
                ScryptedInterface.VideoClips,
            ];
        }
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        const ret = new ClipsMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
        })
        return ret;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    }
}
