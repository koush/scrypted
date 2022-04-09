import { closeQuiet, createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { RefreshPromise } from "@scrypted/common/src/promise-utils";
import { connectRTCSignalingClients } from '@scrypted/common/src/rtc-connect';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, replacePorts } from '@scrypted/common/src/sdp-utils';
import { StorageSettings } from '@scrypted/common/src/settings';
import sdk, { BinarySensor, Camera, Device, DeviceDiscovery, DeviceProvider, FFMpegInput, Intercom, MediaObject, MotionSensor, OnOff, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, ResponseMediaStreamOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { RtcpReceiverInfo, RtcpRrPacket } from '../../../external/werift/packages/rtp/src/rtcp/rr';
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../external/werift/packages/rtp/src/srtp/const';
import { SrtcpSession } from '../../../external/werift/packages/rtp/src/srtp/srtcp';
import { CameraData, clientApi, generateUuid, isStunMessage, LiveCallNegotiation, RingApi, RingCamera, RingRestClient, RtpDescription, SipSession } from './ring-client-api';
import { encodeSrtpOptions, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from './srtp-utils';

enum CaptureModes {
    Default = 'Default',
    UDP = 'RTSP+UDP',
    TCP = 'RTSP+TCP',
    FFmpeg = 'FFmpeg Direct Capture',
}

const STREAM_TIMEOUT = 120000;

const { deviceManager, mediaManager, systemManager } = sdk;

class RingWebSocketRTCSessionControl implements RTCSessionControl {
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

class RingBrowserRTCSessionControl implements RTCSessionControl {
    constructor(public ringCamera: RingCameraDevice, public sessionId: string) {
    }

    async getRefreshAt() {
    }

    async extendSession() {
    }

    async endSession() {
        this.ringCamera.findCamera().endWebRtcSession(this.sessionId);
    }
}

class RingCameraLight extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: RingCameraDevice) {
        super(camera.nativeId + '-light');
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
        captureMode: {
            title: 'SIP Gateway',
            description: 'Experimental: The gateway used to import the stream.',
            choices: Object.values(CaptureModes),
            defaultValue: CaptureModes.Default,
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
        if (!this.session)
            throw new Error("not in call");

        this.stopIntercom();

        const ffmpegInput: FFMpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const ringRtpOptions = this.rtpDescription;
        let cameraSpeakerActive = false;
        const audioOutForwarder = await createBindZero();
        this.audioOutForwarder = audioOutForwarder.server;
        audioOutForwarder.server.on('message', message => {
            if (!cameraSpeakerActive) {
                cameraSpeakerActive = true;
                this.session.activateCameraSpeaker().catch(e => this.console.error('camera speaker activation error', e))
            }

            this.session.audioSplitter.send(message, ringRtpOptions.audio.port, ringRtpOptions.address);
            return null;
        });


        const args = ffmpegInput.inputArguments.slice();
        args.push(
            '-vn', '-dn', '-sn',
            '-acodec', 'pcm_mulaw',
            '-flags', '+global_header',
            '-ac', '1',
            '-ar', '8k',
            '-f', 'rtp',
            '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', encodeSrtpOptions(this.session.rtpOptions.audio),
            `srtp://127.0.0.1:${audioOutForwarder.port}?pkt_size=188`,
        );

        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
        this.audioOutProcess = cp;
        cp.on('exit', () => this.console.log('two way audio ended'));
        this.session.onCallEnded.subscribe(() => {
            closeQuiet(audioOutForwarder.server);
            cp.kill('SIGKILL');
        });
    }

    async stopIntercom(): Promise<void> {
        closeQuiet(this.audioOutForwarder);
        this.audioOutProcess?.kill('SIGKILL');
        this.audioOutProcess = undefined;
        this.audioOutForwarder = undefined;
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

        const useRtsp = this.storageSettings.values.captureMode !== CaptureModes.FFmpeg;
        const useRtspTcp = this.storageSettings.values.captureMode === CaptureModes.TCP;

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
                    closeQuiet(udp);
                }

                client.on('close', cleanup);
                client.on('error', cleanup);
                const camera = this.findCamera();
                sip = await camera.createSipSession(undefined);
                sip.onCallEnded.subscribe(cleanup);
                this.rtpDescription = await sip.start();
                this.console.log('ring sdp', this.rtpDescription.sdp)

                const videoPort = useRtsp ? 0 : sip.videoSplitter.address().port;
                const audioPort = useRtsp ? 0 : sip.audioSplitter.address().port;

                let sdp = replacePorts(this.rtpDescription.sdp, audioPort, videoPort);
                sdp = addTrackControls(sdp);
                sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n');
                this.console.log('proposed sdp', sdp);

                let vseq = 0;
                let vseen = 0;
                let vlost = 0;
                let aseq = 0;
                let aseen = 0;
                let alost = 0;

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
                                return;
                            vseen++;
                            rtsp.sendVideo(message, !isRtpMessage);
                            const seq = getSequenceNumber(message);
                            if (seq !== (vseq + 1) % 0x0FFFF)
                                vlost++;
                            vseq = seq;
                        }
                    });

                    sip.videoRtcpSplitter.on('message', message => {
                        rtsp.sendVideo(message, true);
                    });

                    sip.videoSplitter.once('message', message => {
                        const srtcp = new SrtcpSession({
                            profile: ProtectionProfileAes128CmHmacSha1_80,
                            keys: {
                                localMasterKey: this.rtpDescription.video.srtpKey,
                                localMasterSalt: this.rtpDescription.video.srtpSalt,
                                remoteMasterKey: this.rtpDescription.video.srtpKey,
                                remoteMasterSalt: this.rtpDescription.video.srtpSalt,
                            },
                        });
                        const first = srtcp.decrypt(message);
                        const rtp = RtpPacket.deSerialize(first);

                        const report = new RtcpReceiverInfo({
                            ssrc: rtp.header.ssrc,
                            fractionLost: 0,
                            packetsLost: 0,
                            highestSequence: rtp.header.sequenceNumber,
                            jitter: 0,
                            lsr: 0,
                            dlsr: 0,
                        })

                        const rr = new RtcpRrPacket({
                            ssrc: rtp.header.ssrc,
                            reports: [
                                report,
                            ],
                        });

                        const interval = setInterval(() => {
                            report.highestSequence = vseq;
                            report.packetsLost = vlost;
                            report.fractionLost = Math.round(vlost * 100 / vseen);
                            const packet = srtcp.encrypt(rr.serialize());
                            sip.videoSplitter.send(packet, this.rtpDescription.video.rtcpPort, this.rtpDescription.address)
                        }, 500);
                        sip.videoSplitter.on('close', () => clearInterval(interval))
                    });

                    sip.audioSplitter.on('message', message => {
                        if (!isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                return;
                            aseen++;
                            rtsp.sendAudio(message, !isRtpMessage);
                            const seq = getSequenceNumber(message);
                            if (seq !== (aseq + 1) % 0x0FFFF)
                                alost++;
                            aseq = seq;
                        }
                    });

                    sip.audioRtcpSplitter.on('message', message => {
                        rtsp.sendAudio(message, true);
                    });

                    sip.requestKeyFrame();
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
                    this.session = sip;

                    const packetWaiter = new Promise(resolve => sip.videoSplitter.once('message', resolve));

                    await packetWaiter;

                    await new Promise(resolve => sip.videoSplitter.close(() => resolve(undefined)));
                    await new Promise(resolve => sip.audioSplitter.close(() => resolve(undefined)));
                    await new Promise(resolve => sip.videoRtcpSplitter.close(() => resolve(undefined)));
                    await new Promise(resolve => sip.audioRtcpSplitter.close(() => resolve(undefined)));

                    client.write(sdp + '\r\n');
                    client.end();

                    sip.requestKeyFrame();
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
                    ? ['-rtsp_transport', useRtspTcp ? 'tcp' : 'udp']
                    : ['-f', 'sdp']),
                '-i', playbackUrl,
            ],
        };
        this.ffmpegInput = ffmpegInput;
        this.resetStreamTimeout();

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    getSipMediaStreamOptions(): ResponseMediaStreamOptions {
        const useRtsp = this.storageSettings.values.captureMode !== CaptureModes.FFmpeg;

        return {
            id: 'sip',
            name: 'SIP',
            // note that the rtsp stream comes from scrypted,
            // can bypass ffmpeg parsing.
            // tool: "scrypted",
            container: useRtsp ? 'rtsp' : 'sdp',
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

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
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

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        const options = await session.getOptions();

        const camera = this.findCamera();

        let sessionControl: RTCSessionControl;

        // ring has two webrtc endpoints. one is for the android/ios clients, wherein the ring server
        // sends an offer, which only has h264 high in it, which causes some browsers
        // like Safari (and probably Chromecast) to fail on codec negotiation.
        // if any video capabilities are offered, use the browser endpoint for safety.
        // this should be improved further in the future by inspecting the capabilities
        // since this currently defaults to using the baseline profile on Chrome when high is supported.
        if (options?.capabilities?.video) {
            // the browser path will automatically activate the speaker on the ring.
            let answerSdp: string;
            const sessionId = generateUuid();

            await connectRTCSignalingClients(this.console, session, {
                type: 'offer',
                audio: {
                    direction: 'sendrecv',
                },
                video: {
                    direction: 'recvonly',
                },
            }, {
                createLocalDescription: async (type: 'offer' | 'answer', setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate) => {
                    if (type !== 'answer')
                        throw new Error('Ring Camera default endpoint only supports RTC answer');

                    return {
                        type: 'answer',
                        sdp: answerSdp,
                    };
                },
                setRemoteDescription: async (description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) => {
                    if (description.type !== 'offer')
                        throw new Error('Ring Camera default endpoint only supports RTC answer');
                    const answer = await camera.startWebRtcSession(sessionId, description.sdp);
                    answerSdp = answer;
                },
                addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                    throw new Error("Ring Camera default endpoint does not support trickle ICE");
                },
                getOptions: async () => {
                    return {
                        requiresOffer: true,
                        disableTrickle: true,
                    };
                }
            }, {});

            sessionControl = new RingBrowserRTCSessionControl(this, sessionId);
        }
        else {
            const callSignaling = new LiveCallNegotiation(await camera.startLiveCallNegotiation(), camera);
            sessionControl = new RingWebSocketRTCSessionControl(callSignaling);
            let iceCandidates: RTCIceCandidateInit[] = [];
            let _sendIceCandidate: RTCSignalingSendIceCandidate

            const offerSdp = new Promise<string>((resolve, reject) => {
                callSignaling.onMessage.subscribe(async (message) => {
                    // this.console.log('call signaling', message);
                    if (message.method === 'sdp') {
                        resolve(message.sdp);
                    }
                    else if (message.method === 'close') {
                        reject(new Error(message.reason.text));
                    }
                });
            });

            callSignaling.onMessage.subscribe(async (message) => {
                if (message.method === 'ice') {
                    const candidate = {
                        candidate: message.ice,
                        sdpMLineIndex: message.mlineindex,
                    };
                    if (_sendIceCandidate) {
                        _sendIceCandidate(candidate)
                    }
                    else {
                        iceCandidates.push(candidate);
                    }
                }
            });

            await connectRTCSignalingClients(this.console, {
                createLocalDescription: async (type: 'offer' | 'answer', setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate) => {
                    const offer = await offerSdp;
                    _sendIceCandidate = sendIceCandidate;
                    for (const candidate of iceCandidates) {
                        sendIceCandidate?.(candidate);
                    }
                    return {
                        type: 'offer',
                        sdp: offer,
                    }
                },
                setRemoteDescription: async (description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) => {
                    callSignaling.sendAnswer(description);
                },
                addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                    // seemingly answer trickle is not supported, because its server initiated anyways.
                },
                getOptions: async () => {
                    return {
                    };
                }
            }, {},
                session, {
                type: 'answer',
                audio: {
                    direction: 'sendrecv',
                },
                video: {
                    direction: 'recvonly',
                },
            })

            await callSignaling.activate();
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

    updateState(data: CameraData) {
        if (this.findCamera().hasLight && data.led_status) {
            const light = this.getDevice(undefined);
            light.on = data.led_status === 'on';
        }
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
            camera.onData.subscribe(data => {
                const scryptedDevice = this.devices.get(nativeId);
                if (scryptedDevice)
                    scryptedDevice.updateState(data)
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
