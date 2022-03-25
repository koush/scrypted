import { Settings, MediaObject, MediaStreamOptions, RequestMediaStreamOptions, RTCSignalingChannel, ScryptedDeviceType, ScryptedInterface, VideoCamera, Setting, SettingValue } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from '@scrypted/common/src/wrtc-to-rtsp';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import { StorageSettings } from '@scrypted/common/src/settings';
const { mediaManager } = sdk;

const supportedTypes = [
    ScryptedDeviceType.Camera,
    ScryptedDeviceType.Doorbell,
]

class WebRTCMixin extends SettingsMixinDeviceBase<RTCSignalingChannel & VideoCamera> implements VideoCamera {
    storageSettings = new StorageSettings(this, {
        useUdp: {
            title: 'Use SDP/UDP instead of RTSP/TCP',
            description: 'Experimental',
            type: 'boolean',
            defaultValue: true,
        }
    });

    constructor(options: SettingsMixinDeviceOptions<RTCSignalingChannel & Settings & VideoCamera>) {
        super(options)
    }

    createVideoStreamOptions() {
        return getRTCMediaStreamOptions('webrtc', 'WebRTC', this.storageSettings.values.useUdp);
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera) && options?.id !== 'webrtc') {
            return this.mixinDevice.getVideoStream(options);
        }

        const ffmpegInput = await createRTCPeerConnectionSource({
            console: this.console,
            mediaStreamOptions: this.createVideoStreamOptions(),
            channel: this.mixinDevice,
            useUdp: this.storageSettings.values.useUdp,
        });

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        let ret: MediaStreamOptions[] = [];
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera)) {
            ret = await this.mixinDevice.getVideoStreamOptions();
        }
        ret.push(this.createVideoStreamOptions());
        return ret;
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }
}

class WebRTCSourcePlugin extends AutoenableMixinProvider {
    constructor() {
        super();
        this.on = this.on || false;
    }
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (!supportedTypes.includes(type))
            return;

        if (interfaces.includes('@scrypted/webrtc-sink'))
            return;

        if (!interfaces.includes(ScryptedInterface.RTCSignalingChannel))
            return;

        return [
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Settings,
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new WebRTCMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            group: 'WebRTC',
            groupKey: 'webrtc-source',
            mixinProviderNativeId: this.nativeId,
        })
    }
    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}

export default new WebRTCSourcePlugin();
