import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import sdk, { BufferConverter, BufferConvertorOptions, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, Intercom, MediaObject, MixinProvider, RequestMediaStreamOptions, ResponseMediaStreamOptions, RTCSessionControl, RTCSignalingChannel, RTCSignalingSession, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import crypto from 'crypto';
import { createRTCPeerConnectionSink } from "./ffmpeg-to-wrtc";
import { WebRTCCamera } from "./webrtc-camera";
import { createWebRTCStorageSettings } from "./webrtc-storage-settings";
import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from './wrtc-to-rtsp';

const { mediaManager, systemManager, deviceManager } = sdk;

const supportedTypes = [
    ScryptedDeviceType.Camera,
    ScryptedDeviceType.Doorbell,
];


class WebRTCMixin extends SettingsMixinDeviceBase<VideoCamera & RTCSignalingChannel & Intercom> implements RTCSignalingChannel, VideoCamera, Intercom {
    storageSettings = createWebRTCStorageSettings(this);

    constructor(options: SettingsMixinDeviceOptions<RTCSignalingChannel & Settings & VideoCamera & Intercom>) {
        super(options);
        // this.storageSettings.options = {
        //     hide: {
        //         decoderArguments: async () => {
        //             return this.storageSettings.values.transcode === 'Disabled';
        //         },
        //         encoderArguments: async () => {
        //             return this.storageSettings.values.transcode === 'Disabled';
        //         }
        //     }
        // };
    }

    startIntercom(media: MediaObject): Promise<void> {
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom))
            return this.mixinDevice.startIntercom(media);
        throw new Error("Method not implemented.");
    }

    stopIntercom(): Promise<void> {
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom))
            return this.mixinDevice.stopIntercom();
        throw new Error("Method not implemented.");
    }

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        // if the camera natively has RTCSignalingChannel and the client is not a weird non-browser
        // thing like Alexa, etc, pass through. Otherwise proxy/transcode.

        // but, maybe we should always proxy?

        const options = await session.getOptions();
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.RTCSignalingChannel) && !options?.proxy)
            return this.mixinDevice.startRTCSignalingSession(session);

        const device = systemManager.getDeviceById<VideoCamera>(this.id);
        const hasIntercom = this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom);

        return createRTCPeerConnectionSink(
            session,
            this.storageSettings,
            this.console,
            hasIntercom ? this.mixinDevice : undefined,
            async (destination) => {
                const mo = await device.getVideoStream({
                    video: {
                        codec: 'h264',
                    },
                    audio: {
                        codec: 'opus',
                    },
                    destination,
                });
                const ffInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(mo, ScryptedMimeTypes.FFmpegInput);
                return ffInput;
            },
        );
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    createVideoStreamOptions() {
        const ret = getRTCMediaStreamOptions('webrtc', 'WebRTC', this.storageSettings.values.useSdp);
        ret.source = 'cloud';
        return ret;
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera) && options?.id !== 'webrtc') {
            return this.mixinDevice.getVideoStream(options);
        }

        const { mediaObject } = await createRTCPeerConnectionSource({
            console: this.console,
            mediaStreamOptions: this.createVideoStreamOptions(),
            channel: this.mixinDevice,
            useSdp: this.storageSettings.values.useSdp,
        });

        return mediaObject;
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        let ret: ResponseMediaStreamOptions[] = [];
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera)) {
            ret = await this.mixinDevice.getVideoStreamOptions();
        }
        ret.push(this.createVideoStreamOptions());
        return ret;
    }
}

class WebRTCPlugin extends AutoenableMixinProvider implements DeviceCreator, DeviceProvider, BufferConverter, MixinProvider, Settings {
    storageSettings = createWebRTCStorageSettings(this);

    constructor() {
        super();
        this.unshiftMixin = true;

        this.fromMimeType = ScryptedMimeTypes.FFmpegInput;
        this.toMimeType = ScryptedMimeTypes.RTCSignalingChannel;
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async convert(data: Buffer, fromMimeType: string, toMimeType: string, options?: BufferConvertorOptions): Promise<RTCSignalingChannel> {
        const ffmpegInput: FFmpegInput = JSON.parse(data.toString());

        const storageSettings = this.storageSettings;
        const console = deviceManager.getMixinConsole(options?.sourceId, this.nativeId);

        class OnDemandSignalingChannel implements RTCSignalingChannel {
            async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
                return createRTCPeerConnectionSink(session, storageSettings, console, undefined, async () => ffmpegInput);
            }
        }

        return new OnDemandSignalingChannel();
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        // if this is a webrtc camera, also proxy the signaling channel too
        // for inflexible clients.
        if (interfaces.includes(ScryptedInterface.RTCSignalingChannel)) {
            const ret = [
                ScryptedInterface.RTCSignalingChannel,
            ];
            if (type === ScryptedDeviceType.Speaker) {
                ret.push(ScryptedInterface.Intercom);
            }
            else if (type === ScryptedDeviceType.SmartSpeaker) {
                ret.push(ScryptedInterface.Intercom, ScryptedInterface.Microphone);
            }
            else if (type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) {
                ret.push(ScryptedInterface.VideoCamera, ScryptedInterface.Intercom);
            }
            else if (type === ScryptedDeviceType.Display) {
                // intercom too?
                ret.push(ScryptedInterface.Display);
            }
            else if (type === ScryptedDeviceType.SmartDisplay) {
                // intercom too?
                ret.push(ScryptedInterface.Display, ScryptedInterface.VideoCamera);
            }
            else {
                return;
            }

            return ret;
        }
        else if (supportedTypes.includes(type)) {
            return [
                ScryptedInterface.RTCSignalingChannel,
                ScryptedInterface.Settings,
            ];
        }
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new WebRTCMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            group: 'WebRTC',
            groupKey: 'webrtc',
            mixinProviderNativeId: this.nativeId,
        })
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                description: 'The name of the browser connected camera.',
            }
        ];
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = crypto.randomBytes(8).toString('hex');
        await deviceManager.onDeviceDiscovered({
            name: settings.name?.toString(),
            type: ScryptedDeviceType.Camera,
            nativeId,
            interfaces: [
                ScryptedInterface.RTCSignalingClient,
                ScryptedInterface.Display,
                ScryptedInterface.Intercom,

                // RTCSignalingChannel is actually implemented as a loopback from the browser, but
                // since the feed needs to be tee'd to multiple clients, use VideoCamera instead
                // to do that.
                ScryptedInterface.VideoCamera,
            ],
        });
        return nativeId;
    }

    getDevice(nativeId: string) {
        return new WebRTCCamera(nativeId);
    }
}

export default new WebRTCPlugin();
