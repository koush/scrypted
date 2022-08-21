import { ScryptedDeviceBase, Intercom, Camera, VideoCamera, MotionSensor, BinarySensor, PictureOptions, MediaObject, ScryptedInterface, RequestMediaStreamOptions, FFmpegInput, MediaStreamOptions, MediaStreamUrl, ScryptedMimeTypes, ResponseMediaStreamOptions, OnOff, DeviceProvider, Online, Logger } from "@scrypted/sdk";
import sdk from '@scrypted/sdk';
import { TuyaPlugin } from "./main";
import { TuyaDeviceConfig } from "./tuya/tuya.const";
import { TuyaDevice } from "./tuya/tuya.device";
const { deviceManager, mediaManager, systemManager } = sdk;

export class TuyaCameraLight extends ScryptedDeviceBase implements OnOff, Online {
    constructor(
        public camera: TuyaCamera,
        nativeId: string
    ) {
        super(nativeId);
        this.updateState();
    }

    async turnOff(): Promise<void> {
        await this.setLightSwitch(false);
    }

    async turnOn(): Promise<void> {
        await this.setLightSwitch(true);
    }

    private async setLightSwitch(on: boolean) {
        const camera = this.camera.findCamera();
        const lightSwitchStatus = TuyaDevice.getLightSwitchStatus(camera);

        if (camera.online && lightSwitchStatus) {
            await this.camera.plugin.api.updateDevice(camera, [
                {
                    code: lightSwitchStatus.code,
                    value: on
                }
            ]);
        }
    }

    updateState(camera?: TuyaDeviceConfig) {
        camera = camera || this.camera.findCamera();
        if (!camera)
            return;

        this.online = camera.online;
        this.on = TuyaDevice.getLightSwitchStatus(camera)?.value;
    }
}

export class TuyaCamera extends ScryptedDeviceBase implements DeviceProvider, Intercom, Camera, VideoCamera, MotionSensor, OnOff, Online {
    cameraLight?: TuyaCameraLight
    private pendingSnapshot?: Promise<MediaObject>;

    constructor(
        public plugin: TuyaPlugin,
        nativeId: string,
        tuyaDevice: TuyaDeviceConfig
    ) {
        super(nativeId);

        if (this.interfaces.includes(ScryptedInterface.BinarySensor)) {
            this.binaryState = false;
        }

        this.updateState(tuyaDevice);
    }

    // Camera Light Provider

    getDevice(nativeId: string) {
        if (!this.cameraLight) {
            this.cameraLight = new TuyaCameraLight(this, nativeId);
        }

        return this.cameraLight;
    }

    // OnOff Status Indicator

    async turnOff(): Promise<void> {
        this.setStatusIndicator(false);
    }

    async turnOn(): Promise<void> {
        this.setStatusIndicator(true);
    }

    private async setStatusIndicator(on: boolean) {
        const camera = this.findCamera();
        const statusIndicator = TuyaDevice.getStatusIndicator(camera);

        if (statusIndicator) {
            await this.plugin.api.updateDevice(camera, [
                {
                    code: statusIndicator.code,
                    value: on
                }
            ]);
        }
    }

    // Camera

    async takePicture(
        options?: PictureOptions
    ): Promise<MediaObject> {

        // Throttles snapshot requests, especially for rtsps streams

        const fetchSnapshotFromStream = async () => {
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
            } catch (e) {
                this.logger.w("Could not get screenshot from prebuffer.");
            }
            return undefined;
        }

        const fetchSnapshotFromRTSPS = async () => {
            const camera = this.findCamera();

            if (!camera) {
                this.logger.w(`Could not find camera for ${this.name} to show stream preview.`);
                throw new Error(`Failed to capture snapshot for ${this.name}: Camera not found.`);
            }

            if (!camera.online) {
                this.logger.w(`${this.name} is currently offline. Will not be able to show stream preview until device is back online.`);
                throw new Error(`Failed to capture snapshot for ${this.name}: Camera is offline.`);
            }

            const rtsps = await this.plugin.api.getRTSPS(camera);

            if (!rtsps) {
                this.logger.w("There was an error retreiving camera's rtsps for stream preview.");
                throw new Error(`Failed to capture snapshot for ${this.name}: RTSPS link not found.`);
            }

            const ffmpegInput: FFmpegInput = {
                url: undefined,
                inputArguments: [
                    '-i', rtsps.url,
                    '-frames:v', '1',
                    '-hide_banner',
                    '-f', 'image2',
                    '-'
                ]
            };

            return mediaManager.createFFmpegMediaObject(ffmpegInput);
        }

        if (!this.pendingSnapshot) {
            this.pendingSnapshot = fetchSnapshotFromStream().then(value => value ? value : fetchSnapshotFromRTSPS());
            this.pendingSnapshot?.finally(() => this.pendingSnapshot = undefined);
        }

        return this.pendingSnapshot;
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    // VideoCamera

    async getVideoStream(
        options?: MediaStreamOptions
    ): Promise<MediaObject> {
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos.find(find => find.id === options.id) || vsos[0];

        // Always create new rtsp since it can only be used once and we only have 30 seconds before we can
        // use it.

        const camera = this.findCamera();

        if (!camera) {
            this.logger.w(`Could not find camera for ${this.name} to show stream.`);
            throw new Error(`Failed to stream ${this.name}: Camera not found.`);
        }

        if (!camera.online) {
            this.logger.w(`${this.name} is currently offline. Will not be able to stream until device is back online.`);
            throw new Error(`Failed to stream ${this.name}: Camera is offline.`);
        }

        const rtsps = await this.plugin.api.getRTSPS(camera);

        if (!rtsps) {
            this.logger.w("There was an error retreiving camera's rtsps for streamimg.");
            throw new Error(`Failed to capture stream for ${this.name}: RTSPS link not found.`);
        }

        const streamUrl: MediaStreamUrl = {
            url: rtsps.url,
            container: 'rtsp',
            mediaStreamOptions: vso
        }

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(streamUrl)), ScryptedMimeTypes.MediaStreamUrl);
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [
            {
                id: 'default',
                container: 'rtsp',
                video: {
                    codec: 'h264',
                    width: 1920,
                    height: 1080,
                    bitrate: 2000
                },
                audio: {
                    codec: 'aac'
                },
                source: 'cloud',
                tool: 'scrypted',
                userConfigurable: false
            }
        ];
    }

    // Audio

    async startIntercom(
        media: MediaObject
    ): Promise<void> {
        this.stopIntercom();

        // something wants to start playback on the camera speaker.
        // use their ffmpeg input arguments to spawn ffmpeg to do playback.
        // some implementations read the data from an ffmpeg pipe output and POST to a url (like unifi/amcrest).
        throw new Error('not implemented');
    }

    async stopIntercom(): Promise<void> {
    }

    // Motion

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.

    triggerBinaryState() {
        this.binaryState = true;
        setTimeout(() => this.binaryState = false, 10000);
    }

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.

    triggerMotion() {
        this.motionDetected = true;
        setTimeout(() => this.motionDetected = false, 10000);
    }

    findCamera() {
        return this.plugin.api.cameras.find(device => device.id === this.nativeId);
    }

    updateState(camera?: TuyaDeviceConfig) {
        camera = camera || this.findCamera();
        if (!camera) {
            return;
        }

        this.on = TuyaDevice.getStatusIndicator(camera)?.value;
        this.online = camera.online;

        this.getDevice(this.nativeLightId).updateState(camera);
    }

    private get nativeLightId(): string {
        return `${this.nativeId}-light`;
    }
    private get logger(): Logger {
        return deviceManager.getDeviceLogger(this.nativeId);
    }
}
