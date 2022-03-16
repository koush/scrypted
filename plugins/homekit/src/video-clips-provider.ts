import sdk, { BufferConverter, HttpRequest, HttpRequestHandler, HttpResponse, MediaObject, MixinProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { canCameraMixin } from "./camera-mixin";
import { HOMEKIT_MIXIN } from "./homekit-mixin";
import { StorageSettings } from "@scrypted/common/src/settings";
import { getCameraRecordingFiles, getSavePath, HKSV_MIME_TYPE, nukeClips, parseHksvId, pruneClips } from "./types/camera/camera-recording-files";
import fs from 'fs';
import { ClipsMixin } from "./video-clips-mixin";
import checkDiskSpace from 'check-disk-space';

const { mediaManager, endpointManager } = sdk;

const DAYS_TO_KEEP = 10;
const PRUNE_AGE = DAYS_TO_KEEP * 24 * 60 * 60 * 1000;

export class VideoClipsMixinProvider extends ScryptedDeviceBase implements MixinProvider, Settings, HttpRequestHandler, BufferConverter, Readme {
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

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.isPublicEndpoint) {
            response.send('not authorized', {
                code: 401,
            });
            return;
        }

        response.sendFile(request.url.substring(request.rootPath.length));
    }

    async convert(data: Buffer, fromMimeType: string, toMimeType: string): Promise<MediaObject> {
        if (fromMimeType !== HKSV_MIME_TYPE)
            throw new Error('unknown mime type ' + fromMimeType);

        const { id, startTime } = parseHksvId(data.toString());

        const {
            mp4Name,
            mp4Path,
        } = await getCameraRecordingFiles(id, startTime);

        if (toMimeType.startsWith('video/')) {
            const buffer = fs.readFileSync(mp4Path);
            const mo = await mediaManager.createMediaObject(buffer, 'video/mp4');
            return mo;
        }

        if (toMimeType === ScryptedMimeTypes.LocalUrl) {
            const pub = toMimeType === ScryptedMimeTypes.LocalUrl
                ? await endpointManager.getPublicLocalEndpoint(this.nativeId)
                : await endpointManager.getInsecurePublicLocalEndpoint(this.nativeId);
            const endpoint = pub.replace('/public/', '/');
            const url = new URL(`hksv/${mp4Name}`, endpoint);
            const buffer = Buffer.from(url.pathname);
            const mo = await mediaManager.createMediaObject(buffer, toMimeType);
            return mo;
        }

        throw new Error('unknown homekit conversion' + toMimeType);
    }
}
