import sdk, { Camera, Device, DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, MediaObject, MediaStreamOptions, MediaStreamUrl, MotionSensor, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, VideoCamera } from "@scrypted/sdk";
import { createInstanceableProviderPlugin, enableInstanceableProviderMode, isInstanceableProviderModeEnabled } from '../../../common/src/provider-plugin';
import { SynologyApiClient, SynologyApiError, SynologyCamera, SynologyCameraStream } from "./api/synology-api-client";

const { deviceManager } = sdk;

class SynologyCameraDevice extends ScryptedDeviceBase implements Camera, HttpRequestHandler, MotionSensor, Settings, VideoCamera {
    private static readonly DefaultSensorTimeoutSecs: number = 30;

    private motionTimeout?: NodeJS.Timeout;
    private provider: SynologySurveillanceStation;
    private streams: SynologyCameraStream[];

    constructor(provider: SynologySurveillanceStation, nativeId: string, camera: SynologyCamera) {
        super(nativeId);
        this.provider = provider;

        this.motionDetected = false;
        this.streams = SynologyCameraDevice.identifyStreams(camera);
    }

    public async getSettings(): Promise<Setting[]> {
        const vsos = await this.getVideoStreamOptions();

        return [
            {
                title: 'Motion Sensor Timeout',
                key: 'sensorTimeout',
                type: 'integer',
                value: this.storage.getItem('sensorTimeout') || SynologyCameraDevice.DefaultSensorTimeoutSecs,
                description: 'Time to wait in seconds before clearing the motion detected state.',
            },
            {
                title: 'Motion Sensor Webhook',
                type: 'string',
                readonly: true,
                value: await this.getMotionDetectedWebhookUrl(),
                description: 'To get motion alerts, create an alert rule in Surveillance Station that POSTs to this webhook URL upon motion detected.',
            }
        ];
    }

    public async putSetting(key: string, value: string | number | boolean) {
        this.storage.setItem(key, value?.toString() || '');
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    getSensorTimeout() {
        return (parseInt(this.storage.getItem('sensorTimeout')) || SynologyCameraDevice.DefaultSensorTimeoutSecs) * 1000;
    }

    resetMotionTimeout() {
        clearTimeout(this.motionTimeout);
        this.motionTimeout = setTimeout(() => {
            this.motionDetected = false;
        }, this.getSensorTimeout());
    }

    private async getSnapshot(options?: PictureOptions): Promise<Buffer> {
        const data = await this.provider.api.getCameraSnapshot(this.nativeId);

        return Buffer.from(data);
    }

    public async takePicture(options?: PictureOptions): Promise<MediaObject> {
        const buffer = await this.getSnapshot(options);
        return this.createMediaObject(buffer, 'image/jpeg');
    }

    public async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos.find(check => check.id === options?.id) || vsos[0];

        const rtspChannel = this.streams.find(check => check.id === vso.id);

        let rtspPath = null;

        if (vso.id !== '1') {
            const cameraInfo = await this.provider.api.getCameraInfo(this.nativeId);
            const camStream = cameraInfo?.stm_info?.find(el => el.stmNo.toString() == vso.id);
            if (camStream)
                rtspPath = Buffer.from(camStream.camPath, 'base64').toString('binary')
        }

        if (!rtspPath) {
            const liveViewPaths = await this.provider.api.getCameraLiveViewPath([this.nativeId]);
            if (!liveViewPaths?.length)
                throw new Error(`Unable to locate RTSP stream for camera ${this.nativeId}`);

            rtspPath = liveViewPaths[0].rtspPath;
        }

        const mediaStreamUrl: MediaStreamUrl = {
            url: rtspPath,
            mediaStreamOptions: this.createMediaStreamOptions(rtspChannel),
        }
        return this.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
    }

    private createMediaStreamOptions(stream: SynologyCameraStream) {
        const ret: ResponseMediaStreamOptions = {
            id: stream.id,
            name: stream.id,
            container: 'rtsp',
            video: {
                codec: 'h264',
                width: parseInt(stream.resolution.substring(0, stream.resolution.indexOf('x'))),
                height: parseInt(stream.resolution.substring(stream.resolution.indexOf('x') + 1)),
                bitrate: parseInt(stream.constantBitrate, 10),
                fps: stream.fps
            },
            audio: {
                codec: 'aac',
            },
        };
        return ret;
    }

    public async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        const vsos = this.streams.map(channel => this.createMediaStreamOptions(channel));
        return vsos;
    }

    public async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    public async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.url.endsWith('/motionDetected')) {
            this.motionDetected = true;
            this.resetMotionTimeout();

            response.send('Success', {
                code: 200,
            });
        } else {
            response.send('Unsupported operation', {
                code: 400,
            });
        }
    }

    private async getMotionDetectedWebhookUrl(): Promise<string> {
        const webhookUrl = await sdk.endpointManager.getInsecurePublicLocalEndpoint(this.nativeId);
        return `${webhookUrl}motionDetected`;
    }

    /**
     * Identify and return available streams on the provided camera.
     */
    private static identifyStreams(camera: SynologyCamera): SynologyCameraStream[] {
        // Instead of an array of enabled streams, Synology uses separately named fields.
        // A disabled stream's object is empty (not undefined).
        // This combines them all, puts IDs on them, and filters out disabled ones.
        // Synology has a higher level abstraction, low vs medium vs high profile streams, but more indirection would likely not be helpful here.
        return [
            { ...camera.stream1, id: '1' },
            { ...camera.stream2, id: '2' },
            { ...camera.stream3, id: '3' },
        ].filter(s => !!s.resolution);
    }
}

class SynologySurveillanceStation extends ScryptedDeviceBase implements Settings, DeviceProvider {
    private cameras: SynologyCamera[] = [];
    private cameraDevices: Map<string, SynologyCameraDevice> = new Map();
    api: SynologyApiClient;
    private startup: Promise<void>;
    private discovering: boolean;

    constructor(nativeId?: string) {
        super(nativeId);

        this.startup = this.discoverDevices(0);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    public async discoverDevices(duration: number): Promise<void> {
        if (this.discovering) return;
        this.discovering = true;

        this.console.info(`Fetching list of cameras from Synology server...`);

        try {
            if (!await this.tryLogin()) {
                return;
            }

            this.cameras = await this.api.listCameras();

            if (!this.cameras) {
                this.console.error('Cameras failed to load. Retrying in 10 seconds.');
                setTimeout(() => {
                    this.discoverDevices(0);
                }, 10000);
                return;
            }

            this.console.info(`Discovered ${this.cameras.length} camera(s)`);

            const devices: Device[] = [];
            for (let camera of this.cameras) {
                const d: Device = {
                    providerNativeId: this.nativeId,
                    name: camera.newName,
                    nativeId: '' + camera.id,
                    info: {
                        manufacturer: camera.vendor,
                        model: camera.model,
                        firmware: camera.firmware,
                        serialNumber: `Camera-${camera.id}`,
                    },
                    interfaces: [
                        ScryptedInterface.Camera,
                        ScryptedInterface.HttpRequestHandler,
                        ScryptedInterface.MotionSensor,
                        ScryptedInterface.Settings,
                        ScryptedInterface.VideoCamera,
                    ],
                    type: ScryptedDeviceType.Camera
                };

                devices.push(d);
            }

            for (const d of devices) {
                await deviceManager.onDeviceDiscovered(d);
            }

            // todo: this was done, october 31st. remove sometime later.
            // todo: uncomment after implementing per providerNativeId onDevicesChanged.
            // await deviceManager.onDevicesChanged({
            //     providerNativeId: this.nativeId,
            //     devices
            // });

            for (const device of devices) {
                this.getDevice(device.nativeId);
            }
        }
        catch (e) {
            this.log.a(`device discovery error: ${e}`);
            this.console.error('device discovery error', e);
        } finally {
            this.discovering = false;
        }
    }

    async getDevice(nativeId: string): Promise<any> {
        await this.startup;
        if (this.cameraDevices.has(nativeId))
            return this.cameraDevices.get(nativeId);
        const camera = this.cameras.find(camera => ('' + camera.id) === nativeId);
        if (!camera)
            throw new Error('camera not found?');
        const ret = new SynologyCameraDevice(this, nativeId, camera);
        this.cameraDevices.set(nativeId, ret);
        return ret;
    }

    getSetting(key: string): string {
        return this.storage.getItem(key);
    }

    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [
            {
                key: 'username',
                title: 'Username',
                value: this.getSetting('username'),
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
                value: this.getSetting('password'),
            },
            {
                key: 'otpCode',
                title: 'Verification Code (OTP)',
                description: 'Required only if you have two-factor authentication enabled',
                type: 'integer',
                value: this.getSetting('otpCode'),
            },
            {
                key: 'url',
                title: 'Synology Surveillance Station URL',
                placeholder: 'http://192.168.1.100:5000',
                value: this.getSetting('url'),
            },
        ];

        if (!isInstanceableProviderModeEnabled()) {
            ret.push({
                key: 'instance-mode',
                title: 'Multiple Synology Surveillance Station NVRs',
                value: '',
                description: 'To add more than one Synology Surveillance Station NVR, you will need to migrate the plugin to multi-application mode. Type "MIGRATE" in the textbox to confirm.',
                placeholder: 'MIGRATE',
            });
        }

        return ret;
    }

    async putSetting(key: string, value: string | number) {
        if (key === 'instance-mode') {
            if (value === 'MIGRATE') {
                await enableInstanceableProviderMode();
            }
            return;
        }
        this.storage.setItem(key, value.toString());

        // Delaying discover in case user updated multiple settings, so that it doesn't run until all have been set
        setTimeout(() => this.discoverDevices(0), 200);
    }

    private async tryLogin(): Promise<boolean> {
        this.console.info('Logging into Synology...');

        const url = this.getSetting('url');
        const username = this.getSetting('username');
        const password = this.getSetting('password');
        const otpCode = this.getSetting('otpCode');
        const mfaDeviceId = this.getSetting('mfaDeviceId');

        this.log.clearAlerts();

        if (!url) {
            this.log.a('Must provide URL.');
            return
        }

        if (!username) {
            this.log.a('Must provide username.');
            return
        }

        if (!password) {
            this.log.a('Must provide password.');
            return
        }

        if (!this.api || url !== this.api.url) {
            this.api = new SynologyApiClient(url);
        }

        let successful = false;
        for (let attempt=1; attempt<=3; attempt++) {
            try {
                const newMfaDeviceId = await this.api.login(username, password, otpCode ? parseInt(otpCode) : undefined, !!otpCode, 'Scrypted', mfaDeviceId);

                // If a OTP was present, store the device ID to allow us to skip the OTP requirement next login.
                if (otpCode) {
                    this.storage.setItem('mfaDeviceId', newMfaDeviceId);
                }

                successful = true;
            }
            catch (e) {
                this.log.a(`login error on attempt ${attempt}: ${e}`);
                this.console.error(`login error on attempt ${attempt}`, e);

                if (e instanceof SynologyApiError) {
                    break;
                } else {
                    // Retry on failures that aren't Synology-specific, such as timeouts
                    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
                    continue;
                }
            }
            finally {
                // Clear the OTP setting if provided since it's a temporary code
                if (otpCode) {
                    this.storage.removeItem('otpCode');
                    this.onDeviceEvent(ScryptedInterface.Settings, undefined);
                }
            }           
        }

        if (successful) {
            this.console.info(`Successfully logged into Synology`);
        } else {
            this.console.info(`Failed to log into Synology`);
        }

        return successful;
    }
}

export default createInstanceableProviderPlugin("Synology Surveillance Station NVR", nativeid => new SynologySurveillanceStation(nativeid));
