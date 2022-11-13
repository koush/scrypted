import { defaultPeerConfig } from '@koush/werift';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { Deferred } from '@scrypted/common/src/deferred';
import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { createBrowserSignalingSession } from "@scrypted/common/src/rtc-connect";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import sdk, { BufferConverter, BufferConvertorOptions, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, HttpRequest, Intercom, MediaObject, MixinProvider, RequestMediaStream, RequestMediaStreamOptions, ResponseMediaStreamOptions, RTCSessionControl, RTCSignalingChannel, RTCSignalingSession, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import net from 'net';
import { DataChannelDebouncer } from './datachannel-debouncer';
import { createRTCPeerConnectionSink, parseOptions, RTC_BRIDGE_NATIVE_ID, WebRTCBridge, WebRTCConnectionManagement } from "./ffmpeg-to-wrtc";
import { stunServer, turnServer } from './ice-servers';
import { waitClosed } from './peerconnection-util';
import { WebRTCCamera } from "./webrtc-camera";
import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from './wrtc-to-rtsp';
import { createZygote } from './zygote';

const { mediaManager, systemManager, deviceManager } = sdk;

// https://github.com/shinyoshiaki/werift-webrtc/issues/240
defaultPeerConfig.headerExtensions = {
    video: [],
    audio: [],
};

mediaManager.addConverter({
    fromMimeType: ScryptedMimeTypes.ScryptedDevice,
    toMimeType: ScryptedMimeTypes.RequestMediaStream,
    async convert(data, fromMimeType, toMimeType, options) {
        const device = data as VideoCamera;
        const requestMediaStream: RequestMediaStream = async options => device.getVideoStream(options);
        return requestMediaStream;
    }
});

const zygote = createZygote<ReturnType<typeof fork>>();

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

        const device = systemManager.getDeviceById<VideoCamera & Intercom>(this.id);
        const hasIntercom = this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom);

        const mo = await sdk.mediaManager.createMediaObject(device, ScryptedMimeTypes.ScryptedDevice);

        return createRTCPeerConnectionSink(
            session,
            this.console,
            hasIntercom ? device : undefined,
            mo,
            this.plugin.storageSettings.values.maximumCompatibilityMode,
            this.plugin.getRTCConfiguration(),
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
        },
        useTurnServer: {
            title: 'Use TURN Servers',
            description: 'Use a intermediary server to send video streams. Reduces performance and should only be used with restrictive NATs.',
            type: 'boolean',
            defaultValue: true,
        },
        activeConnections: {
            readonly: true,
            title: "Current Open Connections",
            description: "The WebRTC connections that are currently open.",
            onGet: async () => {
                return {
                    defaultValue: this.activeConnections,
                }
            },
        },
        rtcConfiguration: {
            title: "Custom RTC Configuration",
            description: "RTCConfiguration that can be used to specify custom TURN and STUN servers. https://gist.github.com/koush/f7dafec7dbca04982a76db8243abc57e",
        }
    });
    bridge: WebRTCBridge;
    activeConnections = 0;

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
                        undefined,
                        mo,
                        plugin.storageSettings.values.maximumCompatibilityMode,
                        plugin.getRTCConfiguration(),
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
                    return createRTCPeerConnectionSink(session, console,
                        undefined,
                        mo,
                        plugin.storageSettings.values.maximumCompatibilityMode,
                        plugin.getRTCConfiguration(),
                    );
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
        else if ([
            ScryptedDeviceType.Camera,
            ScryptedDeviceType.Doorbell,
        ].includes(type) && interfaces.includes(ScryptedInterface.VideoCamera)) {
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

    getRTCConfiguration(): RTCConfiguration {
        if (this.storageSettings.values.rtcConfiguration) {
            try {
                return JSON.parse(this.storageSettings.values.rtcConfiguration);
            }
            catch (e) {
                this.console.error('Custom RTC configuration failed. Invalid JSON?', e);
            }
        }
        // google seems to be throttling requests on their open stun server... using a hosted one seems faster.
        const iceServers = this.storageSettings.values.useTurnServer ? [turnServer] : [stunServer];
        return {
            iceServers,
        };
    }

    async onConnection(request: HttpRequest, webSocketUrl: string) {
        const cleanup = new Deferred<string>();
        cleanup.promise.catch(e => this.console.log('cleaning up rtc connection:', e.message));

        const ws = new WebSocket(webSocketUrl);
        cleanup.promise.finally(() => ws.close());

        if (request.isPublicEndpoint) {
            ws.close();
            return;
        }

        const client = await listenZeroSingleClient();
        cleanup.promise.finally(() => {
            client.clientPromise.then(cp => cp.destroy());
        });

        const message = await new Promise<{
            connectionManagementId: string,
            updateSessionId: string,
        }>((resolve, reject) => {
            const close = () => {
                const str = 'Connection closed while waiting for message';
                reject(new Error(str));
                cleanup.resolve(str);
            };
            ws.addEventListener('close', close);

            ws.onmessage = message => {
                ws.removeEventListener('close', close);
                resolve(JSON.parse(message.data));
            }
        });

        const { connectionManagementId, updateSessionId } = message;
        if (connectionManagementId) {
            cleanup.promise.finally(async () => {
                const plugins = await systemManager.getComponent('plugins');
                plugins.setHostParam('@scrypted/webrtc', connectionManagementId);
            });
        }
        if (updateSessionId) {
            cleanup.promise.finally(async () => {
                const plugins = await systemManager.getComponent('plugins');
                plugins.setHostParam('@scrypted/webrtc', updateSessionId);
            });
        }

        try {
            const session = await createBrowserSignalingSession(ws, '@scrypted/webrtc', 'remote');
            const { transcodeWidth, sessionSupportsH264High } = parseOptions(await session.getOptions());

            const result = zygote();
            this.activeConnections++;
            result.worker.on('exit', () => {
                this.activeConnections--;
                cleanup.resolve('worker exited');
            });
            cleanup.promise.finally(() => {
                result.worker.terminate()
            });

            const { createConnection } = await result.result;
            const connection = await createConnection(message, client.port, session,
                this.storageSettings.values.maximumCompatibilityMode, transcodeWidth, sessionSupportsH264High, {
                configuration: this.getRTCConfiguration(),
            });
            cleanup.promise.finally(() => connection.close().catch(() => { }));
            connection.waitClosed().finally(() => cleanup.resolve('peer connection closed'));

            await connection.negotiateRTCSignalingSession();

            const cp = await client.clientPromise;
            cp.on('close', () => cleanup.resolve('socket client closed'));
            process.send(message, cp);
        }
        catch (e) {
            console.error("error negotiating browser RTCC signaling", e);
            cleanup.resolve('error');
            throw e;
        }
    }
}

export async function fork() {
    return {
        async createConnection(message: any, port: number, clientSession: RTCSignalingSession, maximumCompatibilityMode: boolean, transcodeWidth: number, sessionSupportsH264High: boolean, options?: { disableIntercom?: boolean; configuration?: RTCConfiguration; }) {
            const cleanup = new Deferred<string>();
            cleanup.promise.catch(e => this.console.log('cleaning up rtc connection:', e.message));
            cleanup.promise.finally(() => setTimeout(() => process.exit(), 10000));

            const connection = new WebRTCConnectionManagement(console, clientSession, maximumCompatibilityMode, transcodeWidth, sessionSupportsH264High, options);
            const { pc } = connection;
            waitClosed(pc).then(() => cleanup.resolve('peer connection closed'));

            const { connectionManagementId, updateSessionId } = message;
            if (connectionManagementId || updateSessionId) {
                const plugins = await systemManager.getComponent('plugins');
                if (connectionManagementId) {
                    plugins.setHostParam('@scrypted/webrtc', connectionManagementId, connection);
                }
                if (updateSessionId) {
                    await plugins.setHostParam('@scrypted/webrtc', updateSessionId, (session: RTCSignalingSession) => connection.clientSession = session);
                }
            }

            const socket = net.connect(port, '127.0.0.1');
            cleanup.promise.finally(() => socket.destroy());

            const dc = pc.createDataChannel('rpc');
            dc.message.subscribe(message => socket.write(message));

            const debouncer = new DataChannelDebouncer({
                send: u8 => dc.send(Buffer.from(u8)),
            }, e => {
                this.console.error('datachannel send error', e);
                socket.destroy();
            });
            socket.on('data', data => debouncer.send(data));
            socket.on('close', () => cleanup.resolve('socket closed'));
            socket.on('error', () => cleanup.resolve('socket error'));

            return connection;
        }
    }
}

export default WebRTCPlugin;
