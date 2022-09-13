import { defaultPeerConfig, RTCPeerConnection } from '@koush/werift';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { createBrowserSignalingSession } from "@scrypted/common/src/rtc-connect";
import { connectRTCSignalingClients } from '@scrypted/common/src/rtc-signaling';
import { StorageSettings } from '@scrypted/common/src/settings';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import sdk, { BufferConverter, BufferConvertorOptions, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, HttpRequest, Intercom, MediaObject, MixinProvider, RequestMediaStream, RequestMediaStreamOptions, ResponseMediaStreamOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingSession, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import crypto from 'crypto';
import net from 'net';
import { DataChannelDebouncer } from './datachannel-debouncer';
import { createRTCPeerConnectionSink, RTC_BRIDGE_NATIVE_ID, WebRTCBridge } from "./ffmpeg-to-wrtc";
import { stunIceServers } from './ice-servers';
import { waitClosed, waitConnected } from './peerconnection-util';
import { WebRTCCamera } from "./webrtc-camera";
import { WeriftSignalingSession } from './werift-signaling-session';
import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from './wrtc-to-rtsp';

const { mediaManager, systemManager, deviceManager } = sdk;

// https://github.com/shinyoshiaki/werift-webrtc/issues/240
defaultPeerConfig.headerExtensions = {
    video: [],
    audio: [],
};

const supportedTypes = [
    ScryptedDeviceType.Camera,
    ScryptedDeviceType.Doorbell,
];

mediaManager.addConverter({
    fromMimeType: ScryptedMimeTypes.ScryptedDevice,
    toMimeType: ScryptedMimeTypes.RequestMediaStream,
    async convert(data, fromMimeType, toMimeType, options) {
        const device = data as VideoCamera;
        const requestMediaStream: RequestMediaStream = async options => device.getVideoStream(options);
        return requestMediaStream;
    }
});

class WebRTCMixin extends SettingsMixinDeviceBase<VideoCamera & RTCSignalingChannel & Intercom> implements RTCSignalingChannel, VideoCamera, Intercom {
    storageSettings = new StorageSettings(this, {});
    webrtcIntercom: Promise<Intercom>;

    constructor(public plugin: WebRTCPlugin, options: SettingsMixinDeviceOptions<RTCSignalingChannel & Settings & VideoCamera & Intercom>) {
        super(options);
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (this.webrtcIntercom) {
            const intercom = await this.webrtcIntercom;
            return intercom.startIntercom(media);
        }
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom))
            return this.mixinDevice.startIntercom(media);
        throw new Error("webrtc session not connected.");
    }

    async stopIntercom(): Promise<void> {
        if (this.webrtcIntercom) {
            const intercom = await this.webrtcIntercom;
            return intercom.stopIntercom();
        }

        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom))
            return this.mixinDevice.stopIntercom();
        throw new Error("webrtc session not connected.");
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

        const mo = await sdk.mediaManager.createMediaObject(device, ScryptedMimeTypes.ScryptedDevice);

        return createRTCPeerConnectionSink(
            session,
            this.console,
            !hasIntercom,
            mo,
            this.plugin.storageSettings.values.maximumCompatibilityMode,
        );
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    createVideoStreamOptions() {
        const ret = getRTCMediaStreamOptions('webrtc', 'WebRTC');
        ret.source = 'cloud';
        return ret;
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera) && options?.id !== 'webrtc') {
            return this.mixinDevice.getVideoStream(options);
        }

        const { intercom, mediaObject, pcClose } = await createRTCPeerConnectionSource({
            console: this.console,
            mediaStreamOptions: this.createVideoStreamOptions(),
            channel: this.mixinDevice,
            maximumCompatibilityMode: this.plugin.storageSettings.values.maximumCompatibilityMode,
        });

        this.webrtcIntercom = intercom;
        pcClose.finally(() => this.webrtcIntercom = undefined);

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

export class WebRTCPlugin extends AutoenableMixinProvider implements DeviceCreator, DeviceProvider, BufferConverter, MixinProvider, Settings {
    storageSettings = new StorageSettings(this, {
        maximumCompatibilityMode: {
            title: 'Maximum Compatibility Mode',
            description: 'Enables maximum compatibility with WebRTC clients by using the most conservative transcode options.',
            defaultValue: false,
            type: 'boolean',
        }
    });
    bridge: WebRTCBridge;

    constructor() {
        super();
        this.unshiftMixin = true;

        this.fromMimeType = '*/*';
        this.toMimeType = ScryptedMimeTypes.RTCSignalingChannel;

        deviceManager.onDeviceDiscovered({
            name: 'RTC Connection Bridge',
            type: ScryptedDeviceType.API,
            nativeId: RTC_BRIDGE_NATIVE_ID,
            interfaces: [
                ScryptedInterface.BufferConverter,
            ],
            internal: true,
        })
            .then(() => this.bridge = new WebRTCBridge(this, RTC_BRIDGE_NATIVE_ID));
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: BufferConvertorOptions): Promise<RTCSignalingChannel> {
        const plugin = this;

        const console = deviceManager.getMixinConsole(options?.sourceId, this.nativeId);

        if (fromMimeType === ScryptedMimeTypes.FFmpegInput) {
            const ffmpegInput: FFmpegInput = JSON.parse(data.toString());
            const mo = await mediaManager.createFFmpegMediaObject(ffmpegInput);

            class OnDemandSignalingChannel implements RTCSignalingChannel {
                async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
                    return createRTCPeerConnectionSink(session, console,
                        true,
                        mo,
                        plugin.storageSettings.values.maximumCompatibilityMode,
                    );
                }
            }

            return new OnDemandSignalingChannel();
        }
        else if (fromMimeType === ScryptedMimeTypes.RequestMediaStream) {
            const rms = data as RequestMediaStream;
            const mo = await mediaManager.createMediaObject(rms, ScryptedMimeTypes.RequestMediaStream);
            class OnDemandSignalingChannel implements RTCSignalingChannel {
                async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
                    return createRTCPeerConnectionSink(session, console, true, mo, plugin.storageSettings.values.maximumCompatibilityMode);
                }
            }

            return new OnDemandSignalingChannel();
        }
        else {
            throw new Error(`@scrypted/webrtc is unable to convert ${fromMimeType} to ${ScryptedMimeTypes.RTCSignalingChannel}`);
        }
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        // if this is a webrtc camera, also proxy the signaling channel too
        // for inflexible clients.
        if (interfaces.includes(ScryptedInterface.RTCSignalingChannel)) {
            const ret = [
                ScryptedInterface.RTCSignalingChannel,
                ScryptedInterface.Settings,
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
        else if (supportedTypes.includes(type) && interfaces.includes(ScryptedInterface.VideoCamera)) {
            return [
                ScryptedInterface.RTCSignalingChannel,
                // ScryptedInterface.Settings,
            ];
        }
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new WebRTCMixin(this, {
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
        if (nativeId === RTC_BRIDGE_NATIVE_ID)
            return this.bridge;
        return new WebRTCCamera(this, nativeId);
    }

    async onConnection(request: HttpRequest, webSocketUrl: string) {
        const ws = new WebSocket(webSocketUrl);

        if (request.isPublicEndpoint) {
            ws.close();
            return;
        }

        const pc = new RTCPeerConnection();
        const client = await listenZeroSingleClient();
        const socket = net.connect(client.port, client.host);

        const cleanup = () => {
            socket.destroy();
            client.clientPromise.then(cp => cp.destroy());
            pc.close();
            ws.close();
        }

        waitClosed(pc).then(cleanup);

        const message = await new Promise((resolve, reject) => {
            ws.addEventListener('close', () => {
                reject(new Error('Connection closed'));
                cleanup();
            });

            ws.onmessage = message => {
                resolve(JSON.parse(message.data));
            }
        });

        try {
            const session = await createBrowserSignalingSession(ws, '@scrypted/webrtc', 'remote');
            // const dc = pc.createDataChannel('dc');

            const dcPromise = pc.onDataChannel.asPromise();

            const start = Date.now();

            const setup: Partial<RTCAVSignalingSetup> = {
                configuration: {
                    iceServers: stunIceServers,
                },
                datachannel: {
                    label: 'dc',
                    dict: {
                        ordered: true,
                    },
                },
            }

            const weriftSession = new WeriftSignalingSession(this.console, pc);
            await connectRTCSignalingClients(this.console, session, setup, weriftSession, setup);
            await waitConnected(pc);

            const [dc] = await dcPromise;
            dc.message.subscribe(message => {
                socket.write(message);
            });

            const cp = await client.clientPromise;
            cp.on('close', cleanup);
            process.send(message, cp);

            const debouncer = new DataChannelDebouncer({
                send: u8 => dc.send(Buffer.from(u8)),
            }, e => {
                this.console.error('datachannel send error', e);
                socket.destroy();
            });
            socket.on('data', data => debouncer.send(data));
            socket.on('close', cleanup);
        }
        catch (e) {
            console.error("error negotiating browser RTCC signaling", e);
            cleanup();
            throw e;
        }
    }
}

export default WebRTCPlugin;
