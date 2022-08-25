import { ScryptedDeviceBase, VideoCamera, MotionSensor, BinarySensor, MediaObject, ScryptedInterface, MediaStreamOptions, MediaStreamUrl, ScryptedMimeTypes, ResponseMediaStreamOptions, OnOff, DeviceProvider, Online, Logger, Intercom } from "@scrypted/sdk";
import sdk from '@scrypted/sdk';
import { TuyaController } from "./main";
import { TuyaDeviceConfig } from "./tuya/const";
import { TuyaDevice } from "./tuya/device";
const { deviceManager } = sdk;

export class TuyaCameraLight extends ScryptedDeviceBase implements OnOff {
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

        if (!camera) {
            this.log.w(`Camera was not found for ${this.name}`);
            return;
        }

        const lightSwitchStatus = TuyaDevice.getLightSwitchStatus(camera);

        if (camera.online && lightSwitchStatus) {
            await this.camera.controller.cloud?.updateDevice(camera, [
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

        this.on = TuyaDevice.getLightSwitchStatus(camera)?.value;
    }
}

export class TuyaCamera extends ScryptedDeviceBase implements DeviceProvider, VideoCamera, BinarySensor, MotionSensor, OnOff {
    cameraLight?: TuyaCameraLight
    private previousMotion?: any;
    private motionTimeout?: NodeJS.Timeout;

    constructor(
        public controller: TuyaController,
        nativeId: string,
        config: TuyaDeviceConfig
    ) {
        super(nativeId);
        this.updateState(config);
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
        if (!camera) {
            this.log.w(`Camera was not found for ${this.name}`);
            return;
        }

        const statusIndicator = TuyaDevice.getStatusIndicator(camera);

        if (statusIndicator) {
            await this.controller.cloud?.updateDevice(camera, [
                {
                    code: statusIndicator.code,
                    value: on
                }
            ]);
        }
    }

    // VideoCamera

    async getVideoStream(
        options?: MediaStreamOptions
    ): Promise<MediaObject> {
        const vso = (await this.getVideoStreamOptions())[0];

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

        const rtsps = await this.controller.cloud?.getRTSPS(camera);

        if (!rtsps) {
            this.logger.w("There was an error retreiving camera's rtsps for streamimg.");
            throw new Error(`Failed to capture stream for ${this.name}: RTSPS link not found.`);
        }

        const mediaStreamUrl: MediaStreamUrl = {
            url: rtsps.url,
            container: 'rtsp',
            mediaStreamOptions: vso
        }
        return this.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [
            {
                id: 'default',
                container: 'rtsp',
                video: {
                    codec: 'h264',
                },
                audio: {
                    codec: 'pcm_ulaw'
                },
                source: 'cloud',
                tool: 'scrypted',
                userConfigurable: false
            }
        ];
    }

    // Motion

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.

    triggerBinaryState() {
        // TODO: Implement doorbell chime
        // this.binaryState = true;
        // setTimeout(() => this.binaryState = false, 10000);
    }

    // This will trigger a motion detected alert if it has no timeout. If there is a timeout, then
    // it will restart the timeout in order to turn off motion detected

    triggerMotion() {
        const timeoutCallback = () => {
            this.motionDetected = false;
            this.motionTimeout = undefined;
        }
        if (!this.motionTimeout) {
            this.motionTimeout = setTimeout(timeoutCallback, 10 * 1000)
            this.motionDetected = true;
        } else {
            // Cancel the timeout and start again.
            clearTimeout(this.motionTimeout);
            this.motionTimeout = setTimeout(timeoutCallback, 10 * 1000);
        }
    }

    findCamera() {
        return this.controller.cloud?.cameras?.find(device => device.id === this.nativeId);
    }

    updateState(camera?: TuyaDeviceConfig) {
        camera = camera || this.findCamera();

        if (!camera) {
            return;
        }

        this.on = TuyaDevice.getStatusIndicator(camera)?.value;

        const hasMotionSwitchStatus = TuyaDevice.getMotionSwitch(camera) !== undefined;
        if (hasMotionSwitchStatus) {
            const movementDetectedStatus = TuyaDevice.getMotionDetectionStatus(camera);
            if (movementDetectedStatus) {
                if (!this.previousMotion) {
                    this.previousMotion = movementDetectedStatus.value;
                } else if (this.previousMotion !== movementDetectedStatus.value) {
                    this.previousMotion = movementDetectedStatus.value;
                    this.triggerMotion();
                }    
            }
        }
        this.getDevice(this.nativeLightId).updateState(camera);
    }

    private get nativeLightId(): string {
        return `${this.nativeId}-light`;
    }

    private get logger(): Logger {
        return deviceManager.getDeviceLogger(this.nativeId);
    }
}
