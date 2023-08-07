import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { Deferred } from '@scrypted/common/src/deferred';
import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { createBrowserSignalingSession } from "@scrypted/common/src/rtc-connect";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import sdk, { BufferConverter, ConnectOptions, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, HttpRequest, Intercom, MediaObject, MediaObjectOptions, MixinProvider, RTCSessionControl, RTCSignalingChannel, RTCSignalingClient, RTCSignalingOptions, RTCSignalingSession, RequestMediaStream, RequestMediaStreamOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, SettingValue, Settings, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import ip from 'ip';
import net from 'net';
import { DataChannelDebouncer } from './datachannel-debouncer';
import { RTC_BRIDGE_NATIVE_ID, WebRTCConnectionManagement, createRTCPeerConnectionSink, createTrackForwarder } from "./ffmpeg-to-wrtc";
import { stunServer, turnServer, weriftStunServer, weriftTurnServer } from './ice-servers';
import { waitClosed } from './peerconnection-util';
import { WebRTCCamera } from "./webrtc-camera";
import { InterfaceAddresses, MediaStreamTrack, PeerConfig, RTCPeerConnection, defaultPeerConfig } from './werift';
import { WeriftSignalingSession } from './werift-signaling-session';
import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from './wrtc-to-rtsp';
import { createZygote } from './zygote';
import { legacyGetSignalingSessionOptions } from '@scrypted/common/src/rtc-signaling';
import { timeoutPromise } from '@scrypted/common/src/promise-utils';

const { mediaManager, systemManager, deviceManager } = sdk;

// https://github.com/shinyoshiaki/werift-webrtc/issues/240
defaultPeerConfig.headerExtensions = {
    video: [],
    audio: [],
};

const zygote = createZygote<ReturnType<typeof fork>>();

class WebRTCMixin extends SettingsMixinDeviceBase<RTCSignalingClient & VideoCamera & RTCSignalingChannel & Intercom> implements RTCSignalingChannel, VideoCamera, Intercom {
    storageSettings = new StorageSettings(this, {});
    webrtcIntercom: Promise<Intercom>;

    constructor(public plugin: WebRTCPlugin, options: SettingsMixinDeviceOptions<RTCSignalingClient & RTCSignalingChannel & Settings & VideoCamera & Intercom>) {
        super(options);
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (this.webrtcIntercom) {
            const intercom = await this.webrtcIntercom;
            return intercom.startIntercom(media);
        }
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom))
            return this.mixinDevice.startIntercom(media);

        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.RTCSignalingClient)) {
            const session = await this.mixinDevice.createRTCSignalingSession();

            const ret = await createRTCPeerConnectionSink(
                session,
                this.console,
                undefined,
                media,
                this.plugin.storageSettings.values.maximumCompatibilityMode,
                this.plugin.getRTCConfiguration(),
                await this.plugin.getWeriftConfiguration(),
            );
            return;
        }

        // odd code path for arlo that has a webrtc connection only for the speaker
        if ((this.type === ScryptedDeviceType.Speaker || this.type === ScryptedDeviceType.SmartSpeaker)
            && this.mixinDeviceInterfaces.includes(ScryptedInterface.RTCSignalingChannel)) {

            this.console.log('starting webrtc speaker intercom');

            const pc = new RTCPeerConnection();
            const atrack = new MediaStreamTrack({ kind: 'audio' });
            const audioTransceiver = pc.addTransceiver(atrack);
            const weriftSignalingSession = new WeriftSignalingSession(this.console, pc);
            const control = await this.mixinDevice.startRTCSignalingSession(weriftSignalingSession);

            const forwarder = await createTrackForwarder({
                timeStart: Date.now(),
                videoTransceiver: undefined,
                audioTransceiver,
                isLocalNetwork: undefined, destinationId: undefined, ipv4: undefined,
                requestMediaStream: async () => media,
                maximumCompatibilityMode: false,
                clientOptions: undefined,
            });

            waitClosed(pc).finally(() => forwarder.kill());
            forwarder.killPromise.finally(() => pc.close());

            forwarder.killPromise.finally(() => control.endSession());
            return;
        }

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

        const options = await legacyGetSignalingSessionOptions(session);
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.RTCSignalingChannel) && !options?.proxy)
            return this.mixinDevice.startRTCSignalingSession(session);

        const device = systemManager.getDeviceById<VideoCamera & Intercom>(this.id);
        const hasIntercom = this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom);

        const requestMediaStream: RequestMediaStream = async options => device.getVideoStream(options);
        const mo = await mediaManager.createMediaObject(requestMediaStream, ScryptedMimeTypes.RequestMediaStream, {
            sourceId: device.id,
        });

        return createRTCPeerConnectionSink(
            session,
            this.console,
            hasIntercom ? device : undefined,
            mo,
            this.plugin.storageSettings.values.maximumCompatibilityMode,
            this.plugin.getRTCConfiguration(),
            await this.plugin.getWeriftConfiguration(options?.disableTurn),
            options?.requiresAnswer === true ? false : true,
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
        iceInterfaceAddresses: {
            title: 'ICE Interface Addresses',
            description: 'The ICE interface addresses to bind and share with the peer.',
            choices: [
                'Default',
                'Scrypted Server Address',
                'All Addresses',
            ],
            defaultValue: 'Default',
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
            title: "Custom Client RTC Configuration",
            type: 'textarea',
            description: "RTCConfiguration that can be used to specify custom TURN and STUN servers. https://gist.github.com/koush/f7dafec7dbca04982a76db8243abc57e",
        },
        weriftConfiguration: {
            title: "Custom Server RTC Configuration",
            type: 'textarea',
            description: "RTCConfiguration that can be used to specify custom TURN and STUN servers. https://gist.github.com/koush/631d38ac8647a86baaac7b22d863f010",
        },
        debugLog: {
            title: 'Debug Log',
            type: 'boolean',
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
        })
            .then(() => this.bridge = new WebRTCBridge(this, RTC_BRIDGE_NATIVE_ID));
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<RTCSignalingChannel> {
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
                        await plugin.getWeriftConfiguration(),
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
                        await plugin.getWeriftConfiguration(),
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
        if (interfaces.includes(ScryptedInterface.RTCSignalingChannel) || interfaces.includes(ScryptedInterface.RTCSignalingClient)) {
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
                ret.push(ScryptedInterface.Intercom, ScryptedInterface.Display);
            }
            else if (type === ScryptedDeviceType.SmartDisplay) {
                // intercom too?
                ret.push(ScryptedInterface.Intercom, ScryptedInterface.Microphone, ScryptedInterface.Display, ScryptedInterface.VideoCamera);
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

    async getDevice(nativeId: string) {
        if (nativeId === RTC_BRIDGE_NATIVE_ID)
            return this.bridge;
        return new WebRTCCamera(this, nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
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

    async getWeriftConfiguration(disableTurn?: boolean): Promise<Partial<PeerConfig>> {
        let ret: Partial<PeerConfig>;
        if (this.storageSettings.values.weriftConfiguration) {
            try {
                ret = JSON.parse(this.storageSettings.values.weriftConfiguration);
            }
            catch (e) {
                this.console.error('Custom Werift configuration failed. Invalid JSON?', e);
            }
        }

        const iceServers = this.storageSettings.values.useTurnServer && !disableTurn
            ? [weriftStunServer, weriftTurnServer]
            : [weriftStunServer];

        let iceInterfaceAddresses: InterfaceAddresses;
        if (this.storageSettings.values.iceInterfaceAddresses !== 'All Addresses') {
            try {
                for (const address of await sdk.endpointManager.getLocalAddresses()) {
                    if (ip.isV4Format(address)) {
                        iceInterfaceAddresses ||= {};
                        iceInterfaceAddresses.udp4 = address;
                    }
                    else if (ip.isV6Format(address)) {
                        iceInterfaceAddresses ||= {};
                        iceInterfaceAddresses.udp6 = address;
                    }
                }
            }
            catch (e) {
            }
        }

        return {
            iceServers,
            iceInterfaceAddresses,
            ...ret,
        };
    }

    async onConnection(request: HttpRequest, webSocketUrl: string) {
        const cleanup = new Deferred<string>();
        cleanup.promise.then(e => this.console.log('cleaning up rtc connection:', e));

        try {
            const ws = new WebSocket(webSocketUrl);
            cleanup.promise.finally(() => ws.close());

            if (request.isPublicEndpoint) {
                cleanup.resolve('public endpoint not supported');
                return;
            }

            const client = await listenZeroSingleClient();
            cleanup.promise.finally(() => {
                client.cancel();
                client.clientPromise.then(cp => cp.destroy()).catch(() => { });
            });

            const message = await new Promise<{
                connectionManagementId: string,
                updateSessionId: string,
            } & ConnectOptions>((resolve, reject) => {
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

            message.username = request.username;

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

            const session = await createBrowserSignalingSession(ws, '@scrypted/webrtc', 'remote');
            const clientOptions = await legacyGetSignalingSessionOptions(session);

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
                this.storageSettings.values.maximumCompatibilityMode, clientOptions, {
                configuration: this.getRTCConfiguration(),
                weriftConfiguration: await this.getWeriftConfiguration(),
            });
            cleanup.promise.finally(() => connection.close().catch(() => { }));
            connection.waitClosed().finally(() => cleanup.resolve('peer connection closed'));

            timeoutPromise(60000, connection.waitConnected())
            .catch(() => {
                cleanup.resolve('timeout');
            });

            await connection.negotiateRTCSignalingSession();

            const cp = await client.clientPromise;
            cp.on('close', () => cleanup.resolve('socket client closed'));
            sdk.connect(cp, message);
        }
        catch (e) {
            console.error("error negotiating browser RTCC signaling", e);
            cleanup.resolve('error');
        }
    }
}

export async function fork() {
    return {
        async createConnection(message: any, port: number, clientSession: RTCSignalingSession, maximumCompatibilityMode: boolean, clientOptions: RTCSignalingOptions, options: { disableIntercom?: boolean; configuration: RTCConfiguration, weriftConfiguration: Partial<PeerConfig>; }) {
            const cleanup = new Deferred<string>();
            cleanup.promise.catch(e => this.console.log('cleaning up rtc connection:', e.message));
            cleanup.promise.finally(() => setTimeout(() => process.exit(), 10000));

            const connection = new WebRTCConnectionManagement(console, clientSession, maximumCompatibilityMode, clientOptions, options);
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

            if (port) {
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
            }
            else {
                pc.createDataChannel('dummy');
            }

            return connection;
        }
    }
}

class WebRTCBridge extends ScryptedDeviceBase implements BufferConverter {
    constructor(public plugin: WebRTCPlugin, nativeId: string) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.RTCSignalingSession;
        this.toMimeType = ScryptedMimeTypes.RTCConnectionManagement;
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const session = data as RTCSignalingSession;
        const maximumCompatibilityMode = !!this.plugin.storageSettings.values.maximumCompatibilityMode;
        const clientOptions = await legacyGetSignalingSessionOptions(session);

        const result = zygote();

        const cleanup = new Deferred<string>();

        this.plugin.activeConnections++;
        result.worker.on('exit', () => {
            this.plugin.activeConnections--;
            cleanup.resolve('worker exited');
        });
        cleanup.promise.finally(() => {
            result.worker.terminate()
        });

        const { createConnection } = await result.result;
        const connection = await createConnection({}, undefined, session,
            maximumCompatibilityMode,
            clientOptions,
            {
                configuration: this.plugin.getRTCConfiguration(),
                weriftConfiguration: await this.plugin.getWeriftConfiguration(),
            }
        );
        cleanup.promise.finally(() => connection.close().catch(() => { }));
        connection.waitClosed().finally(() => cleanup.resolve('peer connection closed'));
        await connection.negotiateRTCSignalingSession();
        await connection.waitConnected();

        // await connection.negotiateRTCSignalingSession();

        return connection;
    }
}

export default WebRTCPlugin;
