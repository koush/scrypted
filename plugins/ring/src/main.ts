import sdk, { RTCSignalingClientSession, BinarySensor, Camera, Device, DeviceDiscovery, DeviceProvider, MediaObject, MotionSensor, OnOff, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, RTCSessionControl, RTCSignalingChannel, RTCSignalingClientOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, VideoCamera, MediaStreamOptions, FFMpegInput, ScryptedMimeTypes, Intercom } from '@scrypted/sdk';
import { SipSession, isStunMessage, LiveCallNegotiation, clientApi, generateUuid, RingApi, RingCamera, RingRestClient, RtpDescription } from './ring-client-api';
import { StorageSettings } from '@scrypted/common/src/settings';
import { startRTCSignalingSession } from '@scrypted/common/src/rtc-signaling';
import { RefreshPromise } from "@scrypted/common/src/promise-utils"
import { ChildProcess } from 'child_process';
import { createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { RtspServer } from '@scrypted/common/src/rtsp-server'
import dgram from 'dgram';
import { createCryptoLine, getPayloadType, isRtpMessagePayloadType } from './srtp-utils';

const STREAM_TIMEOUT = 120000;

const { deviceManager, mediaManager, systemManager } = sdk;

class RingRTCSessionControl implements RTCSessionControl {
    constructor(public liveCallNegtation: LiveCallNegotiation) {
    }

    async getRefreshAt() {
    }

    async extendSession() {
    }

    async endSession() {
        this.liveCallNegtation.endCall();
    }
}

class RingCameraLight extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: RingCameraDevice) {
        super(camera.id + '-light');
    }
    async turnOff(): Promise<void> {
        await this.camera.findCamera().setLight(false);
    }
    async turnOn(): Promise<void> {
        await this.camera.findCamera().setLight(true);
    }
}

class RingCameraDevice extends ScryptedDeviceBase implements Intercom, Settings, DeviceProvider, Camera, MotionSensor, BinarySensor, RTCSignalingChannel, VideoCamera {
    storageSettings = new StorageSettings(this, {
        ffmpegDirectCapture: {
            title: 'SIP FFmpeg Direct Capture',
            description: 'Experimental: May be faster. May not work.',
            type: 'boolean',
        }
    });
    buttonTimeout: NodeJS.Timeout;

    session: SipSession;
    rtpDescription: RtpDescription;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    ffmpegInput: FFMpegInput;
    refreshTimeout: NodeJS.Timeout;
    picturePromise: RefreshPromise<Buffer>;

    constructor(public plugin: RingPlugin, nativeId: string) {
        super(nativeId);
        this.motionDetected = false;
        this.binaryState = false;
        if (this.interfaces.includes(ScryptedInterface.Battery))
            this.batteryLevel = this.findCamera()?.batteryLevel;
    }

    async startIntercom(media: MediaObject): Promise<void> {
    }
    async stopIntercom(): Promise<void> {
    }


    resetStreamTimeout() {
        this.console.log('starting/refreshing stream');
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(() => this.stopSession(), STREAM_TIMEOUT);
    }

    stopSession() {
        if (this.session) {
            this.console.log('ending sip session');
            this.session.stop();
            this.session = undefined;
        }
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {

        if (options?.refreshAt) {
            if (!this.ffmpegInput?.mediaStreamOptions)
                throw new Error("no stream to refresh");

            const ffmpegInput = this.ffmpegInput;
            ffmpegInput.mediaStreamOptions.refreshAt = Date.now() + STREAM_TIMEOUT;
            this.resetStreamTimeout();
            return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
        }

        this.stopSession();


        const { clientPromise: playbackPromise, port: playbackPort, url: clientUrl } = await listenZeroSingleClient();

        const useRtsp = !this.storageSettings.values.ffmpegDirectCapture;

        const playbackUrl = useRtsp ? `rtsp://127.0.0.1:${playbackPort}` : clientUrl;

        playbackPromise.then(async (client) => {
            client.setKeepAlive(true, 10000);
            let sip: SipSession;
            const udp = (await createBindZero()).server;
            try {
                const cleanup = () => {
                    client.destroy();
                    if (this.session === sip)
                        this.session = undefined;
                    try {
                        this.console.log('stopping ring sip session.');
                        sip.stop();
                    }
                    catch (e) {
                    }
                    try {
                        udp.close();
                    }
                    catch (e) {
                    }
                }

                client.on('close', cleanup);
                client.on('error', cleanup);
                const camera = this.findCamera();
                sip = await camera.createSipSession(undefined);
                sip.onCallEnded.subscribe(cleanup);
                this.rtpDescription = await sip.start();

                const videoPort = useRtsp ? 0 : sip.videoSplitter.address().port;
                const audioPort = useRtsp ? 0 : sip.audioSplitter.address().port;

                const inputSdpLines = [
                    'v=0',
                    'o=105202070 3747 461 IN IP4 0.0.0.0',
                    's=Talk',
                    'c=IN IP4 0.0.0.0',
                    'b=AS:380',
                    't=0 0',
                    'a=rtcp-xr:rcvr-rtt=all:10000 stat-summary=loss,dup,jitt,TTL voip-metrics',
                    `m=audio ${audioPort} RTP/SAVP 0 101`,
                    'a=control:trackID=audio',
                    'a=rtpmap:0 PCMU/8000',
                    createCryptoLine(this.rtpDescription.audio),
                    'a=rtcp-mux',
                    `m=video ${videoPort} RTP/SAVP 99`,
                    'a=control:trackID=video',
                    'a=rtpmap:99 H264/90000',
                    createCryptoLine(this.rtpDescription.video),
                    'a=rtcp-mux'
                ];

                const sdp = inputSdpLines.filter((x) => Boolean(x)).join('\n');
                if (useRtsp) {
                    const rtsp = new RtspServer(client, sdp, udp);
                    rtsp.console = this.console;
                    rtsp.audioChannel = 0;
                    rtsp.videoChannel = 2;

                    await rtsp.handlePlayback();
                    sip.videoSplitter.on('message', message => {
                        if (!isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                this.console.log('rtcp')
                            rtsp.sendVideo(message, !isRtpMessage);
                        }
                    });
                    sip.audioSplitter.on('message', message => {
                        if (!isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                this.console.log('rtcp')
                            rtsp.sendAudio(message, !isRtpMessage);
                        }
                    });

                    // sip.requestKeyFrame();
                    this.session = sip;

                    try {
                        await rtsp.handleTeardown();
                        this.console.log('rtsp client ended');
                    }
                    catch (e) {
                        this.console.log('rtsp client ended ungracefully', e);
                    }
                    finally {
                        cleanup();
                    }
                }
                else {
                    const rtsp = new RtspServer(client, sdp, udp);
                    rtsp.udpPorts = {
                        video: videoPort,
                        audio: audioPort,
                    };
                    rtsp.console = this.console;
                    rtsp.audioChannel = 0;
                    rtsp.videoChannel = 2;

                    const packetWaiter = new Promise(resolve => sip.videoSplitter.once('message', resolve));

                    sip.videoSplitter.on('message', message => {
                        if (!isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                this.console.log('rtcp')
                            rtsp.sendVideo(message, !isRtpMessage);
                        }
                        else {
                            this.console.log('stun')
                        }
                    });
                    sip.audioSplitter.on('message', message => {
                        if (!isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                this.console.log('rtcp')
                            rtsp.sendAudio(message, !isRtpMessage);
                        }
                        else {
                            this.console.log('stun')
                        }
                    });

                    // sip.requestKeyFrame();
                    this.session = sip;

                    await packetWaiter;

                    await new Promise(resolve => sip.videoSplitter.close(() => resolve(undefined)));
                    await new Promise(resolve => sip.audioSplitter.close(() => resolve(undefined)));
                    await new Promise(resolve => sip.videoRtcpSplitter.close(() => resolve(undefined)));
                    await new Promise(resolve => sip.audioRtcpSplitter.close(() => resolve(undefined)));

                    client.write(sdp + '\r\n');
                    client.end();
                }
            }
            catch (e) {
                sip?.stop();
                throw e;
            }
        });

        const ffmpegInput: FFMpegInput = {
            url: playbackUrl,
            mediaStreamOptions: Object.assign(this.getSipMediaStreamOptions(), {
                refreshAt: Date.now() + STREAM_TIMEOUT,
            }),
            inputArguments: [
                ...(useRtsp
                    ? ['-rtsp_transport', 'udp']
                    : ['-f', 'sdp']),
                '-i', playbackUrl,
            ],
        };
        this.ffmpegInput = ffmpegInput;
        this.resetStreamTimeout();

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    getSipMediaStreamOptions(): MediaStreamOptions {
        return {
            id: 'sip',
            name: 'SIP',
            // note that the rtsp stream comes from scrypted,
            // can bypass ffmpeg parsing.
            // tool: "scrypted",
            container: 'rtsp',
            video: {
                codec: 'h264',
            },
            audio: {
                // this is a hint to let homekit, et al, know that it's PCM audio and needs transcoding.
                codec: 'pcm_mulaw',
            },
            source: 'cloud',
            userConfigurable: false,
        };
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        return [
            this.getSipMediaStreamOptions(),
        ]
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async startRTCSignalingSession(session: RTCSignalingClientSession, options?: RTCSignalingClientOptions): Promise<RTCSessionControl> {
        const camera = this.findCamera();

        let sessionControl: RTCSessionControl;

        // ring has two webrtc endpoints. one is for the android/ios clients, wherein the ring server
        // sends an offer, which only has h264 high in it, which causes some browsers 
        // like Safari (and probably Chromecast) to fail on codec negotiation.
        // if any video capabilities are offered, use the browser endpoint for safety.
        // this should be improved further in the future by inspecting the capabilities
        // since this currently defaults to using the baseline profile on Chrome when high is supported.
        if (options?.capabilities.video) {
            // the browser path will automatically activate the speaker on the ring.
            await startRTCSignalingSession(session, undefined, this.console,
                async () => {
                    return {
                        type: 'offer',
                        audio: {
                            direction: 'sendrecv',
                        },
                        video: {
                            direction: 'recvonly',
                        },
                    };
                }, async (description) => {
                    const answer = await camera.startWebRtcSession(generateUuid(), description.sdp);
                    return {
                        type: 'answer',
                        sdp: answer,
                    };
                })
        }
        else {
            const callSignaling = new LiveCallNegotiation(await camera.startLiveCallNegotiation(), camera);
            sessionControl = new RingRTCSessionControl(callSignaling);
            await new Promise((resolve, reject) => {
                callSignaling.onMessage.subscribe(async (message) => {
                    // this.console.log('call signaling', message);
                    if (message.method === 'sdp') {
                        resolve(startRTCSignalingSession(session, message, this.console,
                            async () => {
                                return {
                                    type: 'answer',
                                    audio: {
                                        direction: 'sendrecv',
                                    },
                                    video: {
                                        direction: 'recvonly',
                                    },
                                };
                            },
                            async (description) => {
                                callSignaling.sendAnswer(description);
                                return undefined;
                            }
                        ));
                    }
                    else if (message.method === 'ice') {
                        this.console.log(message.ice);
                        session.addIceCandidate({
                            candidate: message.ice,
                            sdpMLineIndex: message.mlineindex,
                        })
                    }
                    else if (message.method === 'close') {
                        reject(new Error(message.reason.text));
                    }
                });

                callSignaling.activate().catch(reject);
            });
        }

        return sessionControl;
    }

    getDevice(nativeId: string) {
        return new RingCameraLight(this);
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        // if this stream is prebuffered, its safe to use the prebuffer to generate an image
        const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
        try {
            const msos = await realDevice.getVideoStreamOptions();
            const prebuffered: RequestMediaStreamOptions = msos.find(mso => mso.prebuffer);
            if (prebuffered) {
                prebuffered.refresh = false;
                return realDevice.getVideoStream(prebuffered);
            }
        }
        catch (e) {
        }

        let buffer: Buffer;

        const camera = this.findCamera();
        if (!camera)
            throw new Error('camera unavailable');

        // watch for snapshot being blocked due to live stream
        if (!camera.snapshotsAreBlocked) {
            try {
                buffer = await this.plugin.api.restClient.request<Buffer>({
                    url: `https://app-snaps.ring.com/snapshots/next/${camera.id}`,
                    responseType: 'buffer',
                    searchParams: {
                        extras: 'force',
                    },
                    headers: {
                        accept: 'image/jpeg',
                    },
                    allowNoResponse: true,
                });
            }
            catch (e) {
                this.console.error('snapshot failed, falling back to cache');
            }
        }
        if (!buffer) {
            buffer = await this.plugin.api.restClient.request<Buffer>({
                url: clientApi(`snapshots/image/${camera.id}`),
                responseType: 'buffer',
                allowNoResponse: true,
            });
        }

        return mediaManager.createMediaObject(buffer, 'image/jpeg');
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    triggerBinaryState() {
        this.binaryState = true;
        clearTimeout(this.buttonTimeout);
        this.buttonTimeout = setTimeout(() => this.binaryState = false, 10000);
    }

    findCamera() {
        return this.plugin.cameras?.find(camera => camera.id.toString() === this.nativeId);
    }
}

class RingPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    loginClient: RingRestClient;
    api: RingApi;
    devices = new Map<string, RingCameraDevice>();
    cameras: RingCamera[];

    settingsStorage = new StorageSettings(this, {
        systemId: {
            title: 'System ID',
            description: 'Used to provide client uniqueness for retrieving the latest set of events.',
            hide: true,
        },
        email: {
            title: 'Email',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        loginCode: {
            title: 'Two Factor Code',
            description: 'Optional: If 2 factor is enabled on your Ring account, enter the code sent by Ring to your email or phone number.',
            onPut: async (oldValue, newValue) => {
                await this.tryLogin(newValue);
                this.console.log('login completed successfully with 2 factor code');
                await this.discoverDevices(0);
                this.console.log('discovery completed successfully');
            },
            noStore: true,
        },
        refreshToken: {
            hide: true,
        },
        locationIds: {
            title: 'Location ID',
            description: 'Optional: If supplied will on show this locationID.',
            hide: true,
        },
        cameraDingsPollingSeconds: {
            title: 'Poll Interval',
            type: 'number',
            description: 'Optional: Change the default polling interval for motion and doorbell events.',
            defaultValue: 5,
        },
    });

    constructor() {
        super();
        this.discoverDevices(0)
            .catch(e => this.console.error('discovery failure', e));

        if (!this.settingsStorage.values.systemId)
            this.settingsStorage.values.systemId = generateUuid();
    }

    async clearTryDiscoverDevices() {
        this.settingsStorage.values.refreshToken = undefined;
        await this.discoverDevices(0);
        this.console.log('discovery completed successfully');
    }

    async tryLogin(code?: string) {
        const locationIds = this.settingsStorage.values.locationIds ? [this.settingsStorage.values.locationIds] : undefined;
        const cameraDingsPollingSeconds = this.settingsStorage.values.cameraDingsPollingSeconds;
        const cameraStatusPollingSeconds = 20;

        const createRingApi = async () => {
            this.api = new RingApi({
                refreshToken: this.settingsStorage.values.refreshToken,
                ffmpegPath: await mediaManager.getFFmpegPath(),
                locationIds,
                cameraDingsPollingSeconds,
                cameraStatusPollingSeconds,
                systemId: this.settingsStorage.values.systemId,
            });

            this.api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
                this.settingsStorage.values.refreshToken = newRefreshToken;
            });
        }

        if (this.settingsStorage.values.refreshToken) {
            await createRingApi();
            return;
        }

        if (!this.settingsStorage.values.email || !this.settingsStorage.values.password) {
            this.log.a('Enter your Ring usernmae and password to complete setup.');
            throw new Error('refresh token, username, and password are missing.');
        }

        if (!code) {
            this.loginClient = new RingRestClient({
                email: this.settingsStorage.values.email,
                password: this.settingsStorage.values.password,
            });
            try {
                const auth = await this.loginClient.getCurrentAuth();
                this.settingsStorage.values.refreshToken = auth.refresh_token;
            }
            catch (e) {
                if (this.loginClient.promptFor2fa) {
                    this.log.a('Check your email or texts for your Ring login code, then enter it into the Two Factor Code setting to conplete login.');
                    return;
                }
                this.console.error(e);
                this.log.a('Login failed.');
                throw e;
            }
        }
        else {
            try {
                const auth = await this.loginClient.getAuth(code);
                this.settingsStorage.values.refreshToken = auth.refresh_token;
            }
            catch (e) {
                this.console.error(e);
                this.log.a('Login failed.');
                throw e;
            }
        }
        await createRingApi();
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }
    async discoverDevices(duration: number) {
        await this.tryLogin();
        this.console.log('login success, trying discovery');
        const cameras = await this.api.getCameras();
        this.console.log('cameras discovered');
        this.cameras = cameras;
        const devices: Device[] = [];
        for (const camera of cameras) {
            const nativeId = camera.id.toString();
            const interfaces = [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Camera,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.Intercom,
                ScryptedInterface.RTCSignalingChannel,
                ScryptedInterface.Settings,
            ];
            if (camera.operatingOnBattery)
                interfaces.push(ScryptedInterface.Battery);
            if (camera.isDoorbot)
                interfaces.push(ScryptedInterface.BinarySensor);
            if (camera.hasLight)
                interfaces.push(ScryptedInterface.DeviceProvider);
            const device: Device = {
                info: {
                    model: `${camera.model} (${camera.data.kind})`,
                    manufacturer: 'Ring',
                    firmware: camera.data.firmware_version,
                    serialNumber: camera.data.device_id
                },
                nativeId,
                name: camera.name,
                type: camera.isDoorbot ? ScryptedDeviceType.Doorbell : ScryptedDeviceType.Camera,
                interfaces,
            };
            devices.push(device);

            camera.onNewDing.subscribe(e => {
                this.console.log(camera.name, 'onNewDing', e);
            });
            camera.onDoorbellPressed?.subscribe(e => {
                this.console.log(camera.name, 'onDoorbellPressed', e);
                const scryptedDevice = this.devices.get(nativeId);
                scryptedDevice?.triggerBinaryState();
            });
            camera.onMotionDetected?.subscribe((motionDetected) => {
                this.console.log(camera.name, 'onMotionDetected');
                const scryptedDevice = this.devices.get(nativeId);
                if (scryptedDevice)
                    scryptedDevice.motionDetected = motionDetected;
            });
            camera.onBatteryLevel?.subscribe(() => {
                const scryptedDevice = this.devices.get(nativeId);
                if (scryptedDevice)
                    scryptedDevice.batteryLevel = camera.batteryLevel;
            });
        }

        await deviceManager.onDevicesChanged({
            devices,
        });

        for (const camera of cameras) {
            if (!camera.hasLight)
                continue;
            const nativeId = camera.id.toString();
            const device: Device = {
                providerNativeId: nativeId,
                info: {
                    model: `${camera.model} (${camera.data.kind})`,
                    manufacturer: 'Ring',
                    firmware: camera.data.firmware_version,
                    serialNumber: camera.data.device_id
                },
                nativeId: nativeId + '-light',
                name: camera.name + ' Light',
                type: ScryptedDeviceType.Light,
                interfaces: [ScryptedInterface.OnOff],
            };
            deviceManager.onDevicesChanged({
                providerNativeId: nativeId,
                devices: [device],
            });
        }

        for (const camera of cameras) {
            this.getDevice(camera.id.toString());
        }
    }

    getDevice(nativeId: string) {
        if (!this.devices.has(nativeId)) {
            const camera = new RingCameraDevice(this, nativeId);
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }
}

export default new RingPlugin();
