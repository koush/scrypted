import { BinarySensor, BufferConverter, Camera, Device, DeviceDiscovery, DeviceProvider, FFMpegInput, Intercom, MediaObject, MediaStreamOptions, MotionSensor, OnOff, PictureOptions, RequestMediaStreamOptions, RTCAVMessage, RTCAVSignalingOfferSetup, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SipSession, RingApi, RingCamera, RtpDescription, RingRestClient } from './ring-client-api';
import { StorageSettings } from '../../../common/src/settings';
import { bindUdp, bindZero, createBindUdp, createBindZero, listenZeroSingleClient } from '../../../common/src/listen-cluster';
import { createCryptoLine, encodeSrtpOptions, RtpSplitter } from '@homebridge/camera-utils'
import child_process, { ChildProcess, StdioOptions } from 'child_process';
import { createRTCPeerConnectionSource } from '../../../common/src/wrtc-ffmpeg-source';
import { generateUuid } from './ring-client-api';
import fs from 'fs';
import { clientApi } from '@koush/ring-client-api/lib/api/rest-client';
import { createRtspParser, RtspServer } from '../../../common/src/rtsp-server';
import { ffmpegLogInitialOutput } from '../../../common/src/media-helpers';
import dgram from 'dgram';
import { Writable } from 'stream';

function closeQuietly(server: dgram.Socket) {
    try {
        server.close();
    }
    catch (e) {

    }
}

const { log, deviceManager, mediaManager } = sdk;
const STREAM_TIMEOUT = 120000;
const black = fs.readFileSync('black.jpg');

const RingSignalingPrefix = ScryptedMimeTypes.RTCAVSignalingPrefix + 'ring/';
const RingDeviceSignalingPrefix = RingSignalingPrefix + 'x-';
function createRingRTCAVSignalingOfferSetup(signalingMimeType: string): RTCAVSignalingOfferSetup {
    return {
        signalingMimeType,
        audio: {
            direction: 'sendrecv',
        },
        video: {
            direction: 'recvonly',
        },
    };
}

process.env.DEBUG = '*';

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

class RingCameraDevice extends ScryptedDeviceBase implements BufferConverter, DeviceProvider, Intercom, Camera, VideoCamera, MotionSensor, BinarySensor {
    signalingMime: string;
    webrtcSession: string;
    session: SipSession;
    rtpDescription: RtpDescription;
    audioOutForwarder: RtpSplitter;
    audioOutProcess: ChildProcess;
    ffmpegInput: FFMpegInput;
    refreshTimeout: NodeJS.Timeout;

    constructor(public plugin: RingPlugin, nativeId: string) {
        super(nativeId);
        this.motionDetected = false;
        this.binaryState = false;
        if (this.interfaces.includes(ScryptedInterface.Battery))
            this.batteryLevel = this.findCamera()?.batteryLevel;

        this.signalingMime = RingDeviceSignalingPrefix + this.nativeId;
        this.fromMimeType = ScryptedMimeTypes.RTCAVOffer;
        this.toMimeType = this.signalingMime;
    }

    async sendOffer(offer: RTCAVMessage) {
        this.stopWebRtcSession();
        const sessionId = generateUuid();
        // this.webrtcSession = sessionId;
        const answerSdp = await this.findCamera().startWebRtcSession(sessionId, offer.description.sdp);

        const answer: RTCAVMessage = {
            id: undefined,
            description: {
                sdp: answerSdp,
                type: 'answer',
            },
            candidates: [],
            configuration: undefined,
        }
        return answer;
    }

    async convert(data: Buffer, fromMimeType: string): Promise<Buffer> {
        this.stopWebRtcSession();
        const sessionId = generateUuid();
        // this.webrtcSession = sessionId;
        const offer: RTCAVMessage = JSON.parse(data.toString());
        this.console.log('offer sdp', offer.description.sdp);
        const answerSdp = await this.findCamera().startWebRtcSession(sessionId, offer.description.sdp);
        this.console.log('answer sdp', answerSdp);

        const answer: RTCAVMessage = {
            id: undefined,
            description: {
                sdp: answerSdp,
                type: 'answer',
            },
            candidates: [],
            configuration: undefined,
        }

        return Buffer.from(JSON.stringify(answer));
    }

    getDevice(nativeId: string) {
        return new RingCameraLight(this);
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        // watch for snapshot being blocked due to live stream
        const camera = this.findCamera();
        if (!camera || camera.snapshotsAreBlocked) {
            return mediaManager.createMediaObject(black, 'image/jpeg');
        }

        // trigger a refresh, but immediately use whatever is available remotely.
        camera.getSnapshot();
        try {
            // need to cache this and throttle or something.
            const buffer = await this.plugin.client.request<Buffer>({
                url: clientApi(`snapshots/image/${camera.id}`),
                responseType: 'buffer',
            });

            return mediaManager.createMediaObject(buffer, 'image/jpeg');
        }
        catch (e) {
            this.console.error('snapshot error', e);
            return mediaManager.createMediaObject(black, 'image/jpeg');
        }
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
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

    stopWebRtcSession() {
        if (this.webrtcSession) {
            this.console.log('ending webrtc session');
            this.findCamera().endWebRtcSession(this.webrtcSession);
            this.webrtcSession = undefined;
        }
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        if (options?.id === 'webrtc') {
            return mediaManager.createMediaObject(Buffer.from(JSON.stringify(createRingRTCAVSignalingOfferSetup(this.signalingMime))), this.signalingMime);
        }

        if (options?.refreshAt) {
            if (!this.ffmpegInput?.mediaStreamOptions)
                throw new Error("no stream to refresh");

            const ffmpegInput = this.ffmpegInput;
            ffmpegInput.mediaStreamOptions.refreshAt = Date.now() + STREAM_TIMEOUT;
            this.resetStreamTimeout();
            return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
        }

        this.stopSession();


        const { clientPromise: playbackPromise, port: playbackPort } = await listenZeroSingleClient();
        const playbackUrl = `rtsp://127.0.0.1:${playbackPort}`;


        playbackPromise.then(async (client) => {
            let sip: SipSession;
            try {
                const video = await createBindZero();
                const audio = await createBindZero();
                const vrtcp = await createBindUdp(video.port + 1);
                const artcp = await createBindUdp(audio.port + 1);
                video.server.on('message', data => rtsp.sendVideo(data, false));
                audio.server.on('message', data => rtsp.sendAudio(data, false));
                vrtcp.server.on('message', data => rtsp.sendVideo(data, true));
                artcp.server.on('message', data => rtsp.sendAudio(data, true));

                const cleanup = () => {
                    closeQuietly(video.server);
                    closeQuietly(audio.server);
                    closeQuietly(vrtcp.server);
                    closeQuietly(artcp.server);
                    client.destroy();
                    if (this.session === sip)
                        this.session = undefined;
                    try {
                        sip.stop();
                    }
                    catch (e) {
                    }
                }

                client.on('close', cleanup);
                client.on('error', cleanup);

                const camera = this.findCamera();
                sip = await camera.createSipSession({
                    skipFfmpegCheck: true,
                });
                sip.onCallEnded.subscribe(cleanup);
                this.rtpDescription = await sip.start();

                const ff = sip.prepareTranscoder(true, [], this.rtpDescription, audio.port, video.port, '');

                const rtsp = new RtspServer(client, ff.inputSdpLines.filter((x) => Boolean(x)).join('\n'));
                rtsp.audioChannel = 0;
                rtsp.videoChannel = 2;
                await rtsp.handleSetup();

                this.session = sip;
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
                '-rtsp_transport', 'tcp',
                '-i', playbackUrl,
            ],
        };
        this.ffmpegInput = ffmpegInput;
        this.resetStreamTimeout();

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        return [
            this.getSipMediaStreamOptions(),
            this.getWebRtcMediaStreamOptions(),
        ]
    }

    getSipMediaStreamOptions(): MediaStreamOptions {
        return {
            id: 'sip',
            name: 'SIP',
            video: {
                codec: 'h264',
            },
            audio: {
                // this is a hint to let homekit, et al, know that it's PCM audio and needs transcoding.
                codec: 'pcm',
            },
            source: 'cloud',
            userConfigurable: false,
        };
    }

    getWebRtcMediaStreamOptions(): MediaStreamOptions {
        return {
            id: 'webrtc',
            name: 'WebRTC',
            container: this.signalingMime,
            video: {
            },
            audio: {
            },
            source: 'cloud',
            userConfigurable: false,
        };
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (!this.session)
            throw new Error("not in call");

        this.stopIntercom();

        const ffmpegInput: FFMpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const ringRtpOptions = this.rtpDescription;
        const ringAudioLocation = {
            port: ringRtpOptions.audio.port,
            address: ringRtpOptions.address,
        };
        let cameraSpeakerActive = false;
        const audioOutForwarder = new RtpSplitter(({ message }) => {
            if (!cameraSpeakerActive) {
                cameraSpeakerActive = true;
                this.session.activateCameraSpeaker().catch(e => this.console.error('camera speaker activation error', e))
            }

            this.session.audioSplitter.send(message, ringAudioLocation).catch(e => this.console.error('audio splitter error', e))
            return null;
        });
        this.audioOutForwarder = audioOutForwarder;

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
            `srtp://127.0.0.1:${await audioOutForwarder.portPromise}?pkt_size=188`,
        );

        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
        this.audioOutProcess = cp;
        cp.on('exit', () => this.console.log('two way audio ended'));
        this.session.onCallEnded.subscribe(() => {
            audioOutForwarder.close();
            cp.kill('SIGKILL');
        });
    }

    async stopIntercom(): Promise<void> {
        this.audioOutForwarder?.close();
        this.audioOutProcess?.kill('SIGKILL');
        this.audioOutProcess = undefined;
        this.audioOutForwarder = undefined;
    }

    triggerBinaryState() {
        this.binaryState = true;
        setTimeout(() => this.binaryState = false, 10000);
    }
    triggerMotion() {
        this.motionDetected = true;
        setTimeout(() => this.motionDetected = false, 10000);
    }

    findCamera() {
        return this.plugin.cameras?.find(camera => camera.id.toString() === this.nativeId);
    }
}

class RingPlugin extends ScryptedDeviceBase implements BufferConverter, DeviceProvider, DeviceDiscovery, Settings {
    client: RingRestClient;
    api: RingApi;
    devices = new Map<string, RingCameraDevice>();
    cameras: RingCamera[];

    settingsStorage = new StorageSettings(this, {
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
        this.discoverDevices(0);

        this.fromMimeType = RingSignalingPrefix + '*';
        this.toMimeType = ScryptedMimeTypes.FFmpegInput;
    }

    async convert(data: Buffer, fromMimeType: string): Promise<Buffer> {
        const nativeId = fromMimeType.substring(RingDeviceSignalingPrefix.length);
        let device: RingCameraDevice;
        for (const d of this.devices.values()) {
            if (d.nativeId.toLowerCase() === nativeId) {
                device = d as RingCameraDevice;
                break;
            }
        }
        const ffmpegInput = await createRTCPeerConnectionSource(createRingRTCAVSignalingOfferSetup(device.signalingMime), 'default', 'MPEG-TS', device.console, async (offer) => {
            const answer = await device.sendOffer(offer);
            device.console.log('webrtc answer', answer);
            return answer;
        });
        return Buffer.from(JSON.stringify(ffmpegInput));
    }

    async clearTryDiscoverDevices() {
        this.settingsStorage.values.refreshToken = undefined;
        this.client = undefined;
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
            });
        }

        if (this.settingsStorage.values.refreshToken) {
            this.client = new RingRestClient({
                refreshToken: this.settingsStorage.values.refreshToken,
            });
            await createRingApi();
            return;
        }

        if (!this.settingsStorage.values.email || !this.settingsStorage.values.password) {
            this.log.a('Enter your Ring usernmae and password to complete setup.');
            throw new Error('refresh token, username, and password are missing.');
        }

        if (!code) {
            this.client = new RingRestClient({
                email: this.settingsStorage.values.email,
                password: this.settingsStorage.values.password,
            });
            try {
                const auth = await this.client.getCurrentAuth();
                this.settingsStorage.values.refreshToken = auth.refresh_token;
            }
            catch (e) {
                if (this.client.promptFor2fa) {
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
                const auth = await this.client.getAuth(code);
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
        this.cameras = cameras;
        const devices: Device[] = [];
        for (const camera of cameras) {
            const nativeId = camera.id.toString();
            const interfaces = [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.Intercom,
                ScryptedInterface.BufferConverter,
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

            camera.onDoorbellPressed?.subscribe(() => {
                const scryptedDevice = this.devices.get(nativeId);
                scryptedDevice?.triggerBinaryState();
            });
            camera.onMotionDetected?.subscribe(() => {
                const scryptedDevice = this.devices.get(nativeId);
                scryptedDevice?.triggerMotion();
            });
            camera.onMotionStarted?.subscribe(() => {
                const scryptedDevice = this.devices.get(nativeId);
                scryptedDevice?.triggerMotion();
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
