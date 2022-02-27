import { BinarySensor, BufferConverter, Camera, Device, DeviceDiscovery, DeviceProvider, FFMpegInput, Intercom, MediaObject, MediaStreamOptions, MotionSensor, OnOff, PictureOptions, RequestMediaStreamOptions, RTCAVSignalingSetup, RTCSignalingChannel, RTCSignalingChannelOptions, RTCSignalingSession, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { RingApi, RingCamera, RingRestClient } from './ring-client-api';
import { StorageSettings } from '../../..//common/src/settings';
import { ChildProcess } from 'child_process';
import { createRTCPeerConnectionSource } from '../../../common/src/wrtc-to-rtsp';
import { startRTCSignalingSession } from '../../../common/src/rtc-signaling';
import { generateUuid } from './ring-client-api';
import fs from 'fs';
import { clientApi } from './ring-client-api';
import { RefreshPromise, singletonPromise, timeoutPromise } from '@scrypted/common/src/promise-utils';
import { LiveCallNegotiation } from './ring-client-api';
import dgram from 'dgram';

const { deviceManager, mediaManager, systemManager } = sdk;
const black = fs.readFileSync('unavailable.jpg');

const RtcMediaStreamOptionsId = 'webrtc';

const RingSignalingPrefix = ScryptedMimeTypes.RTCAVSignalingPrefix + 'ring/';
const RingDeviceSignalingPrefix = RingSignalingPrefix + 'x-';

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

class RingCameraDevice extends ScryptedDeviceBase implements Settings, BufferConverter, DeviceProvider, Intercom, Camera, VideoCamera, MotionSensor, BinarySensor, RTCSignalingChannel {
    signalingMime: string;
    webrtcSession: string;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    ffmpegInput: FFMpegInput;
    refreshTimeout: NodeJS.Timeout;
    picturePromise: RefreshPromise<Buffer>;
    storageSettings = new StorageSettings(this, {
        motionTimeout: {
            title: 'Motion Timeout',
            description: 'The duration in seconds to wait before resetting the motion sensor.',
            type: 'number',
            defaultValue: 30,
        }
    });
    buttonTimeout: NodeJS.Timeout;
    motionTimeout: NodeJS.Timeout;

    constructor(public plugin: RingPlugin, nativeId: string) {
        super(nativeId);
        this.motionDetected = false;
        this.binaryState = false;
        if (this.interfaces.includes(ScryptedInterface.Battery))
            this.batteryLevel = this.findCamera()?.batteryLevel;

        this.signalingMime = RingDeviceSignalingPrefix + this.nativeId;
        this.fromMimeType = this.signalingMime;
        this.toMimeType = ScryptedMimeTypes.FFmpegInput;
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async startRTCSignalingSession(session: RTCSignalingSession, options?: RTCSignalingChannelOptions) {
        const camera = this.findCamera();

        // ring has two webrtc endpoints. one is for the android/ios clients, wherein the ring server
        // sends an offer, which only has h264 high in it, which causes some browsers 
        // like Safari (and probably Chromecast) to fail on codec negotiation.
        // if any video capabilities are offered, use the browser endpoint for safety.
        // this should be improved further in the future by inspecting the capabilities
        // since this currently defaults to using the baseline profile on Chrome when high is supported.
        if (options?.capabilities.video) {
            // the browser path will automatically activate the speaker on the ring.
            startRTCSignalingSession(session, undefined, async () => {
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
            callSignaling.onMessage.subscribe(async (message) => {
                if (message.method === 'sdp') {
                    await startRTCSignalingSession(session, message,
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
                    )
                }
                else if (message.method === 'ice') {
                    session.addIceCandidate({
                        candidate: message.ice,
                        sdpMLineIndex: message.mlineindex,
                    })
                }
            });
            await callSignaling.activate();
        }
    }

    async convert(data: Buffer, fromMimeType: string): Promise<Buffer> {
        const ff = await createRTCPeerConnectionSource(this, RtcMediaStreamOptionsId);
        const buffer = Buffer.from(JSON.stringify(ff));
        return buffer;
    }

    getDevice(nativeId: string) {
        return new RingCameraLight(this);
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
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

        // watch for snapshot being blocked due to live stream
        const camera = this.findCamera();
        if (!camera || camera.snapshotsAreBlocked) {
            return mediaManager.createMediaObject(black, 'image/jpeg');
        }

        // trigger a refresh, but immediately use whatever is available remotely.
        // ring-client-api debounces snapshot requests, so this is safe to call liberally.
        camera.getSnapshot();

        this.picturePromise = singletonPromise(this.picturePromise, async () => {
            try {
                return await timeoutPromise(1000, camera.getSnapshot());
            }
            catch (e) {
            }

            return this.plugin.client.request<Buffer>({
                url: clientApi(`snapshots/image/${camera.id}`),
                responseType: 'buffer',
            });
        });
        this.picturePromise.cacheDuration = 5000;

        try {
            // need to cache this and throttle or something.
            const buffer = await timeoutPromise(2000, this.picturePromise.promise);
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

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        const buffer = Buffer.from(this.id.toString());
        return mediaManager.createMediaObject(buffer, this.signalingMime);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        return [
            this.getWebRtcMediaStreamOptions(),
        ]
    }

    getWebRtcMediaStreamOptions(): MediaStreamOptions {
        return {
            id: RtcMediaStreamOptionsId,
            name: 'WebRTC',
            container: this.signalingMime,
            video: {
                codec: 'h264',
            },
            audio: {
                codec: 'opus',
            },
            source: 'cloud',
            userConfigurable: false,
        };
    }

    async startIntercom(media: MediaObject): Promise<void> {

    }

    async stopIntercom(): Promise<void> {
        this.audioOutForwarder?.close();
        this.audioOutProcess?.kill('SIGKILL');
        this.audioOutProcess = undefined;
        this.audioOutForwarder = undefined;
    }

    triggerBinaryState() {
        this.binaryState = true;
        clearTimeout(this.buttonTimeout);
        this.buttonTimeout = setTimeout(() => this.binaryState = false, 10000);
    }

    triggerMotion() {
        this.motionDetected = true;
        clearTimeout(this.motionTimeout)
        this.motionTimeout = setTimeout(() => this.motionDetected = false, this.storageSettings.values.motionTimeout);
    }

    findCamera() {
        return this.plugin.cameras?.find(camera => camera.id.toString() === this.nativeId);
    }
}

class RingPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    client: RingRestClient;
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
                systemId: this.settingsStorage.values.systemId,
            });

            this.api.onRefreshTokenUpdated.subscribe(({newRefreshToken}) => {
                this.settingsStorage.values.refreshToken = newRefreshToken;
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
        this.console.log('cameras discovered');
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
            camera.onMotionStarted?.subscribe(() => {
                this.console.log(camera.name, 'onMotionStarted');
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
