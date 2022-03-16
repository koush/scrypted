import { MixinProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { canCameraMixin } from "./camera-mixin";
import { HOMEKIT_MIXIN } from "./homekit-mixin";
import { StorageSettings } from "@scrypted/common/src/settings";
import { getSavePath, nukeClips, pruneClips } from "./types/camera/camera-recording-files";
import { ClipsMixin } from "./video-clips-mixin";
import checkDiskSpace from 'check-disk-space';

const DAYS_TO_KEEP = 10;
const PRUNE_AGE = DAYS_TO_KEEP * 24 * 60 * 60 * 1000;

export class VideoClipsMixinProvider extends ScryptedDeviceBase implements MixinProvider, Settings, Readme {
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
