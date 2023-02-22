import { closeQuiet, createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { RefreshPromise } from "@scrypted/common/src/promise-utils";
import { connectRTCSignalingClients } from '@scrypted/common/src/rtc-signaling';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp, replacePorts } from '@scrypted/common/src/sdp-utils';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import sdk, { BinarySensor, Camera, Device, DeviceDiscovery, DeviceManager, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamUrl, MotionSensor, OnOff, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, ResponseMediaStreamOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, SecuritySystem, SecuritySystemMode, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { RtcpReceiverInfo, RtcpRrPacket } from '../../../external/werift/packages/rtp/src/rtcp/rr';
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../external/werift/packages/rtp/src/srtp/const';
import { SrtcpSession } from '../../../external/werift/packages/rtp/src/srtp/srtcp';
import { Location, isStunMessage, RtpDescription, SipSession, BasicPeerConnection, CameraData, clientApi, generateUuid, RingBaseApi, RingCamera, RingRestClient, rxjs, SimpleWebRtcSession, StreamingSession } from './ring-client-api';
import { encodeSrtpOptions, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from './srtp-utils';
import { LocationMode } from './ring-client-api';

const STREAM_TIMEOUT = 120000;
const { deviceManager, mediaManager, systemManager } = sdk;

class RingWebSocketRTCSessionControl implements RTCSessionControl {
    constructor(public streamingSession: StreamingSession, public onConnectionState: rxjs.Subject<RTCPeerConnectionState>) {
    }

    async setPlayback(options: { audio: boolean; video: boolean; }) {
        if (this.streamingSession.cameraSpeakerActivated !== options.audio)
            this.streamingSession.setCameraSpeaker(options.audio);
    }

    async getRefreshAt() {
    }

    async extendSession() {
    }

    async endSession() {
        this.streamingSession.stop();
    }
}

class RingBrowserRTCSessionControl implements RTCSessionControl {
    constructor(public ringCamera: RingCameraDevice, public simpleSession: SimpleWebRtcSession) {
    }

    async setPlayback(options: { audio: boolean; video: boolean; }) {
    }

    async getRefreshAt() {
    }

    async extendSession() {
    }

    async endSession() {
        await this.simpleSession.end();
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

class RingCameraSiren extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: RingCameraDevice) {
        super(camera.nativeId + '-siren');
    }
    async turnOff(): Promise<void> {
        await this.camera.findCamera().setSiren(false);
    }
    async turnOn(): Promise<void> {
        await this.camera.findCamera().setSiren(true);
    }
}

class RingCameraDevice extends ScryptedDeviceBase implements DeviceProvider, Camera, MotionSensor, BinarySensor, RTCSignalingChannel {
    buttonTimeout: NodeJS.Timeout;
    session: SipSession;
    rtpDescription: RtpDescription;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    currentMedia: FFmpegInput | MediaStreamUrl;
    currentMediaMimeType: string;
    refreshTimeout: NodeJS.Timeout;
    picturePromise: RefreshPromise<Buffer>;

    constructor(public plugin: RingPlugin, public location: RingLocationDevice, nativeId: string) {
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

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

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

    get useRtsp() {
        return true;
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {

        if (options?.metadata?.refreshAt) {
            if (!this.currentMedia?.mediaStreamOptions)
                throw new Error("no stream to refresh");

            const currentMedia = this.currentMedia;
            currentMedia.mediaStreamOptions.refreshAt = Date.now() + STREAM_TIMEOUT;
            currentMedia.mediaStreamOptions.metadata = {
                refreshAt: currentMedia.mediaStreamOptions.refreshAt
            };
            this.resetStreamTimeout();
            return mediaManager.createMediaObject(currentMedia, this.currentMediaMimeType);
        }

        this.stopSession();


        const { clientPromise: playbackPromise, port: playbackPort, url: clientUrl } = await listenZeroSingleClient();

        const useRtsp = this.useRtsp;

        const playbackUrl = useRtsp ? `rtsp://127.0.0.1:${playbackPort}` : clientUrl;

        playbackPromise.then(async (client) => {
            client.setKeepAlive(true, 10000);
            let sip: SipSession;
            try {
                let rtsp: RtspServer;
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
                    rtsp?.destroy();
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
                    rtsp = new RtspServer(client, sdp, true);
                    const parsedSdp = parseSdp(rtsp.sdp);
                    const videoTrack = parsedSdp.msections.find(msection => msection.type === 'video').control;
                    const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;
                    rtsp.console = this.console;

                    await rtsp.handlePlayback();
                    sip.videoSplitter.on('message', message => {
                        if (!isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                return;
                            vseen++;
                            rtsp.sendTrack(videoTrack, message, !isRtpMessage);
                            const seq = getSequenceNumber(message);
                            if (seq !== (vseq + 1) % 0x0FFFF)
                                vlost++;
                            vseq = seq;
                        }
                    });

                    sip.videoRtcpSplitter.on('message', message => {
                        rtsp.sendTrack(videoTrack, message, true);
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
                            rtsp.sendTrack(audioTrack, message, !isRtpMessage);
                            const seq = getSequenceNumber(message);
                            if (seq !== (aseq + 1) % 0x0FFFF)
                                alost++;
                            aseq = seq;
                        }
                    });

                    sip.audioRtcpSplitter.on('message', message => {
                        rtsp.sendTrack(audioTrack, message, true);
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

        this.resetStreamTimeout();

        const mediaStreamOptions = Object.assign(this.getSipMediaStreamOptions(), {
            refreshAt: Date.now() + STREAM_TIMEOUT,
        });
        if (useRtsp) {
            const mediaStreamUrl: MediaStreamUrl = {
                url: playbackUrl,
                mediaStreamOptions,
            };
            this.currentMedia = mediaStreamUrl;
            this.currentMediaMimeType = ScryptedMimeTypes.MediaStreamUrl;

            return mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
        }

        const ffmpegInput: FFmpegInput = {
            url: undefined,
            container: 'sdp',
            mediaStreamOptions,
            inputArguments: [
                '-f', 'sdp',
                '-i', playbackUrl,
            ],
        };
        this.currentMedia = ffmpegInput;
        this.currentMediaMimeType = ScryptedMimeTypes.FFmpegInput;

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
    }

    getSipMediaStreamOptions(): ResponseMediaStreamOptions {
        const useRtsp = this.useRtsp;

        return {
            id: 'sip',
            name: 'SIP',
            // this stream is NOT scrypted blessed due to wackiness in the h264 stream.
            // tool: "scrypted",
            container: useRtsp ? 'rtsp' : 'sdp',
            video: {
                codec: 'h264',
                h264Info: {
                    sei: true,
                    stapb: true,
                    mtap16: true,
                    mtap32: true,
                    fuab: true,
                    reserved0: true,
                    reserved30: true,
                    reserved31: true,
                }
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
        if (options?.capabilities?.video
            // this endpoint does not work on ring edge.
            && !camera.isRingEdgeEnabled) {
            // the browser path will automatically activate the speaker on the ring.
            let answerSdp: string;
            const simple = camera.createSimpleWebRtcSession();

            await connectRTCSignalingClients(this.console, session, {
                type: 'offer',
                audio: {
                    direction: 'sendrecv',
                },
                video: {
                    direction: 'recvonly',
                },
                getUserMediaSafariHack: true,
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
                    answerSdp = await simple.start(description.sdp);
                },
                addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                    throw new Error("Ring Camera default endpoint does not support trickle ICE");
                },
                getOptions: async () => {
                    return {
                        requiresOffer: true,
                        disableTrickle: true,
                    };
                },
            }, {});

            sessionControl = new RingBrowserRTCSessionControl(this, simple);
        }
        else {
            const onIceCandidate = new rxjs.ReplaySubject<RTCIceCandidateInit>();
            const onConnectionState = new rxjs.Subject<RTCPeerConnectionState>();

            const configuration: RTCConfiguration = {
                iceServers: [
                    {
                        urls: [
                            'stun:stun.kinesisvideo.us-east-1.amazonaws.com:443',
                            'stun:stun.kinesisvideo.us-east-2.amazonaws.com:443',
                            'stun:stun.kinesisvideo.us-west-2.amazonaws.com:443',
                            'stun:stun.l.google.com:19302',
                            'stun:stun1.l.google.com:19302',
                            'stun:stun2.l.google.com:19302',
                            'stun:stun3.l.google.com:19302',
                            'stun:stun4.l.google.com:19302',
                        ]
                    }
                ]
            }

            const offerSetup: RTCAVSignalingSetup = {
                type: 'offer',
                audio: {
                    direction: 'sendrecv',
                },
                video: {
                    direction: 'recvonly',
                },
                configuration,
            };
            const answerSetup: RTCAVSignalingSetup = {
                type: 'answer',
                audio: undefined,
                video: undefined,
                configuration,
            };

            const basicPc: BasicPeerConnection = {
                createOffer: async () => {
                    const local = await session.createLocalDescription('offer', offerSetup, async (candidate) => {
                        onIceCandidate.next(candidate)
                    });

                    return {
                        sdp: local.sdp,
                    }
                },
                createAnswer: async (offer: RTCSessionDescriptionInit) => {
                    await session.setRemoteDescription(offer, answerSetup);
                    const local = await session.createLocalDescription('answer', answerSetup, async (candidate) => {
                        onIceCandidate.next(candidate)
                    });

                    return {
                        type: 'answer',
                        sdp: local.sdp,
                    }
                },
                acceptAnswer: async (answer: RTCSessionDescriptionInit) => {
                    await session.setRemoteDescription(answer, offerSetup);
                },
                addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                    await session.addIceCandidate(candidate);
                },
                close: () => {
                    sessionControl.endSession();
                },
                onIceCandidate,
                onConnectionState,
            };

            const ringSession = await camera.startLiveCall({
                createPeerConnection: () => basicPc,
            });
            ringSession.connection.onMessage.subscribe(message => this.console.log('incoming message', message));
            ringSession.onCallEnded.subscribe(() => this.console.error('call ended', ringSession.sessionId));

            sessionControl = new RingWebSocketRTCSessionControl(ringSession, onConnectionState);

            // todo: fix this in sdk
            // setTimeout(() => {
            //     this.console.log('activating connected');
            //     onConnectionState.next('connected');
            // }, 5000);
        }

        return sessionControl;
    }

    async getDevice(nativeId: string) {
        if (nativeId.endsWith('-siren')) {
            return new RingCameraSiren(this);
        }
        return new RingCameraLight(this);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        // if this stream is prebuffered, its safe to use the prebuffer to generate an image
        const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
        try {
            if (realDevice.interfaces.includes(ScryptedInterface.VideoCamera)) {
                const msos = await realDevice.getVideoStreamOptions();
                const prebuffered: RequestMediaStreamOptions = msos.find(mso => mso.prebuffer);
                if (prebuffered) {
                    prebuffered.refresh = false;
                    return realDevice.getVideoStream(prebuffered);
                }
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
                buffer = await this.plugin.api.restClient.request({
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
            buffer = await this.plugin.api.restClient.request({
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
        const location = this.location.findLocation();
        return location.cameras?.find(camera => camera.id.toString() === this.nativeId);
    }

    async updateState(data: CameraData) {
        if (this.findCamera().hasLight && data.led_status) {
            const light = await this.getDevice('light');
            light.on = data.led_status === 'on';
        }

        if (this.findCamera().hasSiren && data.siren_status) {
            const siren = await this.getDevice('-siren');
            siren.on = data.siren_status.seconds_remaining > 0 ? true : false;
        }
    }
}

export class RingLocationDevice extends ScryptedDeviceBase implements DeviceProvider, SecuritySystem {
    devices = new Map<string, RingCameraDevice>();

    constructor(public plugin: RingPlugin, nativeId: string) {
        super(nativeId);

        const location = this.findLocation();
        const updateLocationMode = (f: LocationMode) => {
            let mode: SecuritySystemMode;
            if (f === 'away')
                mode = SecuritySystemMode.AwayArmed;
            else if (f === 'home')
                mode = SecuritySystemMode.HomeArmed;
            else
                mode = SecuritySystemMode.Disarmed;

            this.securitySystemState = {
                mode,
                // how to get this?
                triggered: false,
                supportedModes: [
                    SecuritySystemMode.Disarmed,
                    SecuritySystemMode.AwayArmed,
                    SecuritySystemMode.HomeArmed,
                ]
            }
        }
        location.onLocationMode.subscribe(updateLocationMode);

        if (location.hasAlarmBaseStation) {
            location.getLocationMode().then(response => {
                updateLocationMode(response.mode);
            });

            if (!this.securitySystemState) {
                updateLocationMode('disabled');
            }
        }
    }

    async armSecuritySystem(mode: SecuritySystemMode): Promise<void> {
        const location = this.findLocation();
        if (mode === SecuritySystemMode.AwayArmed) {
            await location.armAway();
        }
        else if (mode === SecuritySystemMode.HomeArmed) {
            await location.armHome();
        }
        else if (mode === SecuritySystemMode.NightArmed) {
            await location.armHome();
        }
        else if (mode === SecuritySystemMode.Disarmed) {
            await location.disarm();
        }
    }

    async disarmSecuritySystem(): Promise<void> {
        const location = this.findLocation();
        await location.disarm();
    }

    findLocation() {
        return this.plugin.locations.find(l => l.id === this.nativeId);
    }

    async getDevice(nativeId: string) {
        if (!this.devices.has(nativeId)) {
            const location = new RingCameraDevice(this.plugin, this, nativeId);
            this.devices.set(nativeId, location);
        }
        return this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }
}

class RingPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
    loginClient: RingRestClient;
    api: RingBaseApi;
    devices = new Map<string, RingLocationDevice>();
    locations: Location[];

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
        const cameraStatusPollingSeconds = 20;

        const createRingApi = async () => {
            this.api = new RingBaseApi({
                refreshToken: this.settingsStorage.values.refreshToken,
                ffmpegPath: await mediaManager.getFFmpegPath(),
                locationIds,
                cameraStatusPollingSeconds,
                cameraDingsPollingSeconds: this.settingsStorage.values.cameraDingsPollingSeconds,
                systemId: this.settingsStorage.values.systemId,
            }, {
                createPeerConnection: () => {
                    throw new Error('unreachable');
                },
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
            this.log.a('Enter your Ring username and password to complete setup.');
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
        const locations = await this.api.getLocations();
        this.locations = locations;

        const locationDevices: Device[] = locations.map(location => {
            const interfaces = [
                ScryptedInterface.DeviceProvider,
            ];
            let type = ScryptedDeviceType.DeviceProvider;
            if (location.hasAlarmBaseStation) {
                interfaces.push(ScryptedInterface.SecuritySystem);
                type = ScryptedDeviceType.SecuritySystem;
            }
            return {
                nativeId: location.id,
                name: location.name,
                type,
                interfaces,
            };
        });

        // backwards compat to prevent camera clobbering.
        for (const location of locationDevices) {
            await deviceManager.onDeviceDiscovered(location);
        }

        for (const location of locations) {
            const devices: Device[] = [];
            const cameras = location.cameras;
            for (const camera of cameras) {
                const nativeId = camera.id.toString();
                const interfaces = [
                    ScryptedInterface.Camera,
                    ScryptedInterface.MotionSensor,
                    ScryptedInterface.RTCSignalingChannel,
                ];
                if (!camera.isRingEdgeEnabled) {
                    interfaces.push(
                        ScryptedInterface.VideoCamera,
                        ScryptedInterface.Intercom,
                    );
                }
                if (camera.operatingOnBattery)
                    interfaces.push(ScryptedInterface.Battery);
                if (camera.isDoorbot)
                    interfaces.push(ScryptedInterface.BinarySensor);
                if (camera.hasLight)
                    interfaces.push(ScryptedInterface.DeviceProvider);
                if (camera.hasSiren)
                    interfaces.push(ScryptedInterface.DeviceProvider);
                const device: Device = {
                    info: {
                        model: `${camera.model} (${camera.data.kind})`,
                        manufacturer: 'Ring',
                        firmware: camera.data.firmware_version,
                        serialNumber: camera.data.device_id
                    },
                    providerNativeId: location.id,
                    nativeId,
                    name: camera.name,
                    type: camera.isDoorbot ? ScryptedDeviceType.Doorbell : ScryptedDeviceType.Camera,
                    interfaces,
                };
                devices.push(device);

                const getScryptedDevice = async () => {
                    const locationDevice = await this.getDevice(location.id);
                    const scryptedDevice = await locationDevice?.getDevice(nativeId);
                    return scryptedDevice;
                }

                camera.onDoorbellPressed?.subscribe(async e => {
                    this.console.log(camera.name, 'onDoorbellPressed', e);
                    const scryptedDevice = await getScryptedDevice();
                    scryptedDevice?.triggerBinaryState();
                });
                camera.onMotionDetected?.subscribe(async motionDetected => {
                    if (motionDetected)
                        this.console.log(camera.name, 'onMotionDetected');
                    const scryptedDevice = await getScryptedDevice();
                    if (scryptedDevice)
                        scryptedDevice.motionDetected = motionDetected;
                });
                camera.onMotionDetectedPolling?.subscribe(async motionDetected => {
                    if (motionDetected)
                        this.console.log(camera.name, 'onMotionDetected');
                    const scryptedDevice = await getScryptedDevice();
                    if (scryptedDevice)
                        scryptedDevice.motionDetected = motionDetected;
                });
                camera.onBatteryLevel?.subscribe(async () => {
                    const scryptedDevice = await getScryptedDevice();
                    if (scryptedDevice)
                        scryptedDevice.batteryLevel = camera.batteryLevel;
                });
                camera.onData.subscribe(async data => {
                    const scryptedDevice = await getScryptedDevice();
                    scryptedDevice?.updateState(data)
                });
            }

            await deviceManager.onDevicesChanged({
                providerNativeId: location.id,
                devices: devices,
            });

            for (const camera of cameras) {
                if (camera.hasSiren || camera.hasLight) {
                    const nativeId = camera.id.toString();
                    let devices = [];
                    if (camera.hasLight) {
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
                        devices.push(device);
                    }
                    if (camera.hasSiren) {
                        const device: Device = {
                            providerNativeId: nativeId,
                            info: {
                                model: `${camera.model} (${camera.data.kind})`,
                                manufacturer: 'Ring',
                                firmware: camera.data.firmware_version,
                                serialNumber: camera.data.device_id
                            },
                            nativeId: nativeId + '-siren',
                            name: camera.name + ' Siren',
                            type: ScryptedDeviceType.Siren,
                            interfaces: [ScryptedInterface.OnOff],
                        };
                        devices.push(device);
                    }
                    deviceManager.onDevicesChanged({
                        providerNativeId: nativeId,
                        devices: devices,
                    });
                }
            }

            const locationDevice = await this.getDevice(location.id);
            for (const camera of cameras) {
                locationDevice.getDevice(camera.id.toString());
            }
        }

        // safe to clobber.
        await deviceManager.onDevicesChanged({
            devices: locationDevices,
        });
    }

    async getDevice(nativeId: string) {
        if (!this.devices.has(nativeId)) {
            const location = new RingLocationDevice(this, nativeId);
            this.devices.set(nativeId, location);
        }
        return this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }
}

export default RingPlugin;
