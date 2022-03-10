import sdk, { ScryptedDeviceBase, DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, Device, MotionSensor, ScryptedInterface, Camera, MediaStreamOptions, PictureOptions } from "@scrypted/sdk";
import { createInstanceableProviderPlugin, enableInstanceableProviderMode, isInstanceableProviderModeEnabled } from '../../../common/src/provider-plugin';
import {SynologyApiClient, SynologyCameraStream, SynologyCamera} from "./api/synology-api-client";

const { deviceManager, mediaManager } = sdk;

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

    private getDefaultStream(vsos: MediaStreamOptions[]) {
        let defaultStreamIndex = vsos.findIndex(vso => vso.id === this.storage.getItem('defaultStream'));
        if (defaultStreamIndex === -1)
            defaultStreamIndex = 0;

        return vsos[defaultStreamIndex];
    }

    public async getSettings(): Promise<Setting[]> {
        const vsos = await this.getVideoStreamOptions();
        const defaultStream = this.getDefaultStream(vsos);

        return [
            {
                title: 'Default Stream',
                key: 'defaultStream',
                value: defaultStream?.name,
                choices: vsos.map(vso => vso.name),
                description: 'The default stream to use when not specified',
            },
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
        if (key === 'defaultStream') {
            const vsos = await this.getVideoStreamOptions();
            const stream = vsos.find(vso => vso.name === value);
            this.storage.setItem('defaultStream', stream?.id);
        }
        else {
            this.storage.setItem(key, value?.toString());
        }
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
        return mediaManager.createMediaObject(buffer, 'image/jpeg');
    }

    public async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos.find(check => check.id === options?.id) || this.getDefaultStream(vsos);

        const rtspChannel = this.streams.find(check => check.id === vso.id);

        const liveViewPaths = await this.provider.api.getCameraLiveViewPath([this.nativeId]);
        if (!liveViewPaths?.length)
            throw new Error(`Unable to locate RTSP stream for camera ${this.nativeId}`);

        return mediaManager.createFFmpegMediaObject({
            url: liveViewPaths[0].rtspPath,
            inputArguments: [
                "-rtsp_transport", "tcp",
                "-i", liveViewPaths[0].rtspPath,
            ],
            mediaStreamOptions: this.createMediaStreamOptions(rtspChannel),
        });
    }

    private createMediaStreamOptions(stream: SynologyCameraStream) {
        const ret: MediaStreamOptions = {
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

    public async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
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
    private cameras: SynologyCamera[];
    private cameraDevices: Map<string, SynologyCameraDevice> = new Map();
    api: SynologyApiClient;
    private startup: Promise<void>;

    constructor(nativeId?: string) {
        super(nativeId);

        this.startup = this.discoverDevices(0);
    }

    public async discoverDevices(duration: number): Promise<void> {
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

        try {
            const newMfaDeviceId = await this.api.login(username, password, otpCode ? parseInt(otpCode) : undefined, !!otpCode, 'Scrypted', mfaDeviceId);

            // If a OTP was present, store the device ID to allow us to skip the OTP requirement next login.
            if (otpCode) {
                this.storage.setItem('mfaDeviceId', newMfaDeviceId);
            }
        }
        catch (e) {
            this.log.a(`login error: ${e}`);
            this.console.error('login error', e);

            // Clear device ID upon login failure, since it's likely useless now
            this.storage.removeItem('mfaDeviceId');

            return;
        }
        finally {
            // Clear the OTP setting if provided since it's a temporary code
            if (otpCode) {
                this.storage.removeItem('otpCode');
                this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            }
        }

        try {
            this.cameras = await this.api.listCameras();

            if (!this.cameras) {
                this.console.error('Cameras failed to load. Retrying in 10 seconds.');
                setTimeout(() => {
                    this.discoverDevices(0);
                }, 100000);
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
        this.discoverDevices(0);
    }
}

export default createInstanceableProviderPlugin("Synology Surveillance Station NVR", nativeid => new SynologySurveillanceStation(nativeid));
