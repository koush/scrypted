import { BinarySensor, Device, DeviceDiscovery, DeviceProvider, FFMpegInput, MediaObject, MediaStreamOptions, MotionSensor, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import ring, { RingApi, RingCamera } from 'ring-client-api';
import { StorageSettings } from '../../../common/src/settings';
import { listenZeroSingleClient } from '../../../common/src/listen-cluster';
import { RingRestClient } from 'ring-client-api/lib/api/rest-client';
import { randomBytes } from 'crypto';

const { log, deviceManager, mediaManager } = sdk;

class RingCameraDevice extends ScryptedDeviceBase implements VideoCamera, MotionSensor, BinarySensor {
    sessions = new Map<string, ring.SipSession>();
    constructor(public plugin: RingPlugin, nativeId: string) {
        super(nativeId);
    }
    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        // this is from sip
        const { port, clientPromise } = await listenZeroSingleClient();
        const camera = this.findCamera();
        const id = randomBytes(8).toString('hex');
        const sip = await camera.streamVideo({
            output: [
                '-f', 'mpegts',
                `tcp://127.0.0.1:${port}`,
            ],
        });

        const client = await clientPromise;
        // client.on('data', data => this.console.log(data));

        this.sessions.set(id, sip);
        sip.onCallEnded.subscribe(() => this.sessions.delete(id));

        // this is from the consumer
        const passthrough = await listenZeroSingleClient();
        passthrough.clientPromise.then(pt => client.pipe(pt));

        this.console.log(`sip output port: ${port}, consumer input port ${passthrough.port}`);

        const ffmpegInput: FFMpegInput = {
            url: undefined,
            inputArguments: [
                '-f', 'mpegts',
                '-i', `tcp://127.0.0.1:${passthrough.port}`,
            ]
        };

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        return;
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
        return this.plugin.cameras.find(camera => camera.id.toString() === this.nativeId);
    }
}

class RingPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    client: RingRestClient;
    api: RingApi;
    devices = new Map<string, RingCameraDevice>();
    cameras: RingCamera[];

    settingsStorage = new StorageSettings(this, {
        email: {
            title: 'Email',
            onPut: async () => this.clearTryLogin(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => this.clearTryLogin(),
        },
        loginCode: {
            title: 'Two Factor Code',
            description: 'Optional: If 2 factor is enabled on your Ring account, enter the code sent by Ring to your email or phone number.',
            onPut: async (oldValue, newValue) => this.tryLogin(newValue),
            noStore: true,
        },
        refreshToken: {
            hide: true,
        }
    }, this.storage);

    constructor() {
        super();
        this.discoverDevices(0);
    }

    clearTryLogin() {
        this.settingsStorage.values.refreshToken = undefined;
        this.client = undefined;
        this.tryLogin();
    }

    async tryLogin(code?: string) {
        if (this.settingsStorage.values.refreshToken) {
            this.client = new RingRestClient({
                refreshToken: this.settingsStorage.values.refreshToken,
            });
            this.api = new RingApi({
                refreshToken: this.settingsStorage.values.refreshToken,
                ffmpegPath: await mediaManager.getFFmpegPath(),
            });
            return;
        }

        if (!this.settingsStorage.values.email || !this.settingsStorage.values.password)
            return;

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
                return;
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
                return;
            }
        }
        this.api = new RingApi({
            refreshToken: this.settingsStorage.values.refreshToken,
            ffmpegPath: await mediaManager.getFFmpegPath(),
        });
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }
    async discoverDevices(duration: number) {
        await this.tryLogin();
        const cameras = await this.api.getCameras();
        this.cameras = cameras;
        const devices: Device[] = [];
        for (const camera of cameras) {
            const nativeId = camera.id.toString();
            const isDoorbell = camera.model.toLowerCase().includes('doorbell');
            const interfaces = [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.MotionSensor,
            ];
            if (isDoorbell)
                interfaces.push(ScryptedInterface.BinarySensor);
            const device: Device = {
                info: {
                    model: camera.model,
                    manufacturer: 'Ring',
                },
                nativeId,
                name: camera.name,
                type: isDoorbell ? ScryptedDeviceType.Doorbell : ScryptedDeviceType.Camera,
                interfaces,
            };
            devices.push(device);

            camera.onDoorbellPressed?.subscribe(() => {
                const camera = this.devices.get(nativeId);
                camera?.triggerBinaryState();
            });
            camera.onMotionDetected?.subscribe(() => {
                const camera = this.devices.get(nativeId);
                camera?.triggerMotion();
            });
        }
        this.console.log(cameras);

        await deviceManager.onDevicesChanged({
            devices,
        });

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
