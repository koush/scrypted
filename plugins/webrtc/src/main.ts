import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { Deferred } from '@scrypted/common/src/deferred';
import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { timeoutPromise } from '@scrypted/common/src/promise-utils';
import { createBrowserSignalingSession } from "@scrypted/common/src/rtc-connect";
import { legacyGetSignalingSessionOptions } from '@scrypted/common/src/rtc-signaling';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import { createZygote } from '@scrypted/common/src/zygote';
import sdk, { BufferConverter, MediaConverter, ConnectOptions, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, HttpRequest, Intercom, MediaObject, MediaObjectOptions, MixinProvider, RTCSessionControl, RTCSignalingChannel, RTCSignalingClient, RTCSignalingOptions, RTCSignalingSession, RequestMediaStream, RequestMediaStreamOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, ScryptedNativeId, Setting, SettingValue, Settings, VideoCamera, WritableDeviceState } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import ip from 'ip';
import net from 'net';
import os from 'os';
import { DataChannelDebouncer } from './datachannel-debouncer';
import { WebRTCConnectionManagement, createRTCPeerConnectionSink, createTrackForwarder } from "./ffmpeg-to-wrtc";
import { stunServers, turnServers, weriftStunServers, weriftTurnServers } from './ice-servers';
import { waitClosed } from './peerconnection-util';
import { WebRTCCamera } from "./webrtc-camera";
import { MediaStreamTrack, PeerConfig, RTCPeerConnection, defaultPeerConfig } from './werift';
import { WeriftSignalingSession } from './werift-signaling-session';
import { RTCPeerConnectionPipe, createRTCPeerConnectionSource, getRTCMediaStreamOptions } from './wrtc-to-rtsp';
import worker_threads from 'worker_threads';

const { mediaManager, systemManager, deviceManager } = sdk;

// https://github.com/shinyoshiaki/werift-webrtc/issues/240
defaultPeerConfig.headerExtensions = {
    video: [],
    audio: [],
};

const zygote = worker_threads.isMainThread ? createZygote<ReturnType<typeof fork>>() : undefined;

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
                isLocalNetwork: undefined, destinationId: undefined, ipv4: undefined, type: undefined,
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

        const result = zygote();
        this.plugin.activeConnections++;
        result.worker.on('exit', () => {
            this.plugin.activeConnections--;
        });

        const fork = await result.result;

        const { getIntercom, mediaObject, pcClose } = await fork.createRTCPeerConnectionSource({
            __json_copy_serialize_children: true,
            nativeId: this.nativeId,
            mixinId: this.id,
            mediaStreamOptions: this.createVideoStreamOptions(),
            startRTCSignalingSession: (session) => this.mixinDevice.startRTCSignalingSession(session),
            maximumCompatibilityMode: this.plugin.storageSettings.values.maximumCompatibilityMode,
        });

        this.webrtcIntercom = getIntercom();
        const pcc = pcClose();
        pcc.finally(() => {
            this.webrtcIntercom = undefined;
            result.worker.terminate();
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

export class WebRTCPlugin extends AutoenableMixinProvider implements DeviceCreator, DeviceProvider, MediaConverter, MixinProvider, Settings {
    storageSettings = new StorageSettings(this, {
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
        maximumCompatibilityMode: {
            group: 'Advanced',
            title: 'Maximum Compatibility Mode',
            description: 'Enables maximum compatibility with WebRTC clients by using the most conservative transcode options.',
            defaultValue: false,
            type: 'boolean',
        },
        useTurnServer: {
            group: 'Advanced',
            title: 'Use TURN Servers',
            description: 'Uses a intermediary server to send video streams when necessary. Traverses around restrictive NATs.',
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
        },
        ipv4Ban: {
            group: 'Advanced',
            title: '6to4 Ban',
            description: 'The following IP addresses will trigger forcing an IPv6 connection. The default list includes T-Mobile\'s 6to4 gateway.',
            defaultValue: [
                // '192.0.0.4',
            ],
            choices: [
                '192.0.0.4',
            ],
            combobox: true,
            multiple: true,
        }
    });
    activeConnections = 0;

    constructor() {
        super();
        this.unshiftMixin = true;

        this.converters = [
            ["*/*", ScryptedMimeTypes.RTCSignalingChannel],
            [ScryptedMimeTypes.RTCSignalingSession, ScryptedMimeTypes.RTCConnectionManagement],
            [ScryptedMimeTypes.RTCSignalingChannel, ScryptedMimeTypes.FFmpegInput],
        ]

        deviceManager.onDevicesChanged({ devices: [] });
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async convertToSignalingChannel(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<RTCSignalingChannel> {
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

    async convertToRTCConnectionManagement(result: ReturnType<typeof zygote>, cleanup: Deferred<string>, data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const weriftConfiguration = await this.getWeriftConfiguration();
        const session = data as RTCSignalingSession;
        const maximumCompatibilityMode = !!this.storageSettings.values.maximumCompatibilityMode;
        const clientOptions = await legacyGetSignalingSessionOptions(session);

        let connection: WebRTCConnectionManagement;
        try {
            const { createConnection } = await result.result;
            connection = await createConnection({}, undefined, session,
                maximumCompatibilityMode,
                clientOptions,
                {
                    configuration: this.getRTCConfiguration(),
                    weriftConfiguration,
                    ipv4Ban: this.storageSettings.values.ipv4Ban,
                }
            );
        }
        catch (e) {
            result.worker.terminate();
            throw e;
        }
        handleCleanupConnection(cleanup, connection, result);
        await connection.negotiateRTCSignalingSession();
        await connection.waitConnected();

        return connection;
    }

    async convertToFFmpegInput(result: ReturnType<typeof zygote>, cleanup: Deferred<string>, data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const channel = data as RTCSignalingChannel;
        try {
            const { createRTCPeerConnectionSource } = await result.result;
            const rtcSource = await createRTCPeerConnectionSource({
                __json_copy_serialize_children: true,
                nativeId: undefined,
                mixinId: undefined,
                mediaStreamOptions: {
                    id: 'webrtc',
                    name: 'WebRTC',
                    source: 'cloud',
                },
                startRTCSignalingSession: (session) => channel.startRTCSignalingSession(session),
                maximumCompatibilityMode: this.storageSettings.values.maximumCompatibilityMode,
            });

            const mediaStreamUrl = rtcSource.mediaObject;
            return await mediaManager.convertMediaObject(mediaStreamUrl, ScryptedMimeTypes.FFmpegInput);
        } catch (e) {
            result.worker.terminate();
            throw e;
        }
    }

    async convertMedia(data: any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        const getFork = (cleanup: Deferred<string>) => {
            const result = zygote();
            this.activeConnections++;
            result.worker.on('exit', () => {
                this.activeConnections--;
                cleanup.resolve('worker exited (convert)');
            });
            return result;
        }

        let converter: () => Promise<any>;
        let cleanup = new Deferred<string>();
        if (fromMimeType === ScryptedMimeTypes.RTCSignalingSession && toMimeType === ScryptedMimeTypes.RTCConnectionManagement) {
            const result = getFork(cleanup);
            converter = () => this.convertToRTCConnectionManagement(result, cleanup, data, fromMimeType, toMimeType, options);
        }
        else if (fromMimeType === ScryptedMimeTypes.RTCSignalingChannel && toMimeType === ScryptedMimeTypes.FFmpegInput) {
            const result = getFork(cleanup);
            converter = () => this.convertToFFmpegInput(result, cleanup, data, fromMimeType, toMimeType, options);
        }
        else if (toMimeType === ScryptedMimeTypes.RTCSignalingChannel) {
            converter = () => this.convertToSignalingChannel(data, fromMimeType, toMimeType, options);
        }
        else {
            throw new Error(`@scrypted/webrtc is unable to convert ${fromMimeType} to ${toMimeType}`);
        }

        try {
            return await timeoutPromise(2 * 60 * 1000, converter());
        }
        catch (e) {
            cleanup.resolve(e.toString());
            throw e;
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

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
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
        const iceServers = this.storageSettings.values.useTurnServer ? [...turnServers] : [...stunServers];
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
            ? [...weriftStunServers, ...weriftTurnServers]
            : [...weriftStunServers];

        let iceAdditionalHostAddresses: string[];
        let iceUseIpv4: boolean;
        let iceUseIpv6: boolean;
        if (this.storageSettings.values.iceInterfaceAddresses !== 'All Addresses') {
            try {
                // if local addresses are set in scrypted, use those.
                iceAdditionalHostAddresses = await sdk.endpointManager.getLocalAddresses();
            }
            catch (e) {
            }
        }

        iceAdditionalHostAddresses ||= [];

        if (iceAdditionalHostAddresses.length) {
            // sanity check that atleast one of these addresses is valid... ip may change on server.
            const ni = Object.values(os.networkInterfaces()).flat();
            iceAdditionalHostAddresses = iceAdditionalHostAddresses.filter(la => ni.find(check => check.address === la));
            if (iceAdditionalHostAddresses.length) {
                // disable the default address collection mechanism and use the explicitly provided list.
                iceUseIpv4 = false;
                iceUseIpv6 = false;
            }
        }

        // the additional addresses don't need to be validated? maybe?
        if (ret?.iceAdditionalHostAddresses)
            iceAdditionalHostAddresses.push(...ret.iceAdditionalHostAddresses);

        // deduplicate
        iceAdditionalHostAddresses = [...new Set(iceAdditionalHostAddresses)];

        if (!iceAdditionalHostAddresses.length)
            iceAdditionalHostAddresses = undefined;

        return {
            iceServers,
            iceUseIpv4,
            iceUseIpv6,
            iceAdditionalHostAddresses,
            ...ret,
        };
    }

    async onConnection(request: HttpRequest, webSocketUrl: string) {
        const weriftConfiguration = await this.getWeriftConfiguration();

        const cleanup = new Deferred<string>();
        cleanup.promise.then(e => this.console.log('cleaning up rtc connection:', e));

        try {
            const ws = new WebSocket(webSocketUrl);
            cleanup.promise.finally(() => ws.close());

            if (request.isPublicEndpoint) {
                cleanup.resolve('public endpoint not supported');
                return;
            }

            const client = await listenZeroSingleClient('127.0.0.1');
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
                cleanup.resolve('worker exited (onConnection)');
            });

            let connection: WebRTCConnectionManagement;
            try {
                const { createConnection } = await result.result;
                connection = await createConnection(message, client.port, session,
                    this.storageSettings.values.maximumCompatibilityMode, clientOptions, {
                    configuration: this.getRTCConfiguration(),
                    weriftConfiguration,
                    ipv4Ban: this.storageSettings.values.ipv4Ban,
                });
            }
            catch (e) {
                result.worker.terminate();
                throw e;
            }
            handleCleanupConnection(cleanup, connection, result);

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

function handleCleanupConnection(cleanup: Deferred<string>, connection: WebRTCConnectionManagement, result: ReturnType<typeof zygote>) {
    cleanup.promise.finally(() => {
        connection.close().catch(() => { });
        setTimeout(() => result.worker.terminate(), 30000)
    });
    connection.waitClosed().finally(() => cleanup.resolve('peer connection closed'));
}

export async function fork() {
    return {
        async createRTCPeerConnectionSource(options: {
            __json_copy_serialize_children: true,
            mixinId: string,
            nativeId: ScryptedNativeId,
            mediaStreamOptions: ResponseMediaStreamOptions,
            startRTCSignalingSession: (session: RTCSignalingSession) => Promise<RTCSessionControl | undefined>,
            maximumCompatibilityMode: boolean,
        }): Promise<RTCPeerConnectionPipe> {
            return createRTCPeerConnectionSource({
                nativeId: this.nativeId,
                mixinId: options.mixinId,
                mediaStreamOptions: options.mediaStreamOptions,
                startRTCSignalingSession: (session) => options.startRTCSignalingSession(session),
                maximumCompatibilityMode: options.maximumCompatibilityMode,
            });
        },

        async createConnection(message: any,
            port: number,
            clientSession: RTCSignalingSession,
            maximumCompatibilityMode: boolean,
            clientOptions: RTCSignalingOptions,
            options: {
                disableIntercom?: boolean;
                configuration: RTCConfiguration;
                weriftConfiguration: Partial<PeerConfig>;
                ipv4Ban?: string[];
            }) {

            // T-Mobile has a bad 6to4 gateway. When 192.0.0.4 is detected, all ipv4 addresses, besides relay addresses for ipv6 addresses, should be ignored.
            // thus, the candidate should only be configured if the remote host or relatedAddress is IPv6.

            // a=candidate:2099470302 1 udp 2113937151 192.0.0.4 54018 typ host generation 0 network-cost 999
            // a=candidate:2171408532 1 udp 2113939711 2607:fb90:eef3:16d9:ad3:fa57:997f:e9e2 43501 typ host generation 0 network-cost 999
            // a=candidate:1759977254 1 udp 1677729535 172.59.218.164 24868 typ srflx raddr 192.0.0.4 rport 54018 generation 0 network-cost 999
            // a=candidate:1759256926 1 udp 1677732095 2607:fb90:eef3:16d9:ad3:fa57:997f:e9e2 43501 typ srflx raddr 2607:fb90:eef3:16d9:ad3:fa57:997f:e9e2 rport 43501 generation 0 network-cost 999
            // a=candidate:821872401 1 udp 33565183 2604:2dc0:200:26d:: 62773 typ relay raddr 2607:fb90:eef3:16d9:ad3:fa57:997f:e9e2 rport 43501 generation 0 network-cost 999
            // a=candidate:3452552806 1 udp 33562623 147.135.36.109 61385 typ relay raddr 172.59.218.164 rport 24868 generation 0 network-cost 999

            let banned = false;
            options.weriftConfiguration.iceFilterCandidatePair = (pair) => {
                // console.log('pair', pair.protocol.type, pair.localCandidate.host, pair.remoteCandidate.host, pair.remoteCandidate.relatedAddress);

                const wasBanned = banned;
                banned ||= options.ipv4Ban?.includes(pair.remoteCandidate.host);
                banned ||= options.ipv4Ban?.includes(pair.remoteCandidate.relatedAddress);

                if (!wasBanned && banned) {
                    console.warn('Banned 6to4 gateway detected, forcing IPv6.', pair.remoteCandidate.host, pair.remoteCandidate.relatedAddress);
                }

                if (!banned)
                    return true;

                if (!ip.isV4Format(pair.remoteCandidate.host))
                    return true;
                if (!ip.isV4Format(pair.remoteCandidate.relatedAddress))
                    return true;
                return false;
            }

            const cleanup = new Deferred<string>();
            cleanup.promise.catch(e => this.console.log('cleaning up rtc connection:', e.message));

            const connection = new WebRTCConnectionManagement(console, clientSession, maximumCompatibilityMode, clientOptions, options);
            cleanup.promise.finally(() => connection.close().catch(() => { }));
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
                dc.onMessage.subscribe(message => socket.write(message));

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

export default WebRTCPlugin;
