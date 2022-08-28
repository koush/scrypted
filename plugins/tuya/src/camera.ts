import sdk, { ScryptedDeviceBase, VideoCamera, MotionSensor, BinarySensor, MediaObject, MediaStreamOptions, MediaStreamUrl, ScryptedMimeTypes, ResponseMediaStreamOptions, OnOff, DeviceProvider, Online, Logger, Intercom, RTCSignalingClient, RTCSignalingSession, RTCAVSignalingSetup, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingChannel, RTCSessionControl } from "@scrypted/sdk";
import { connectRTCSignalingClients } from '@scrypted/common/src/rtc-signaling';
import { TuyaController } from "./main";
import { TuyaDeviceConfig, WebRTCDeviceConfig } from "./tuya/const";
import { TuyaDevice } from "./tuya/device";
import { TuyaMQ } from "./tuya/mq";
const { deviceManager } = sdk;

export class TuyaCameraLight extends ScryptedDeviceBase implements OnOff, Online {
    constructor(
        public camera: TuyaCamera,
        nativeId: string
    ) {
        super(nativeId);
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
        this.online = camera.online;
    }
}

class TuyaRTCSessionControl implements RTCSessionControl {
    constructor(
        private config: WebRTCDeviceConfig
    ) {
    }

    getRefreshAt(): Promise<number | void> {
        throw new Error("Method not implemented.");
    }
    extendSession(): Promise<void> {
        throw new Error("Method not implemented.");
    }
    endSession(): Promise<void> {
        throw new Error("Method not implemented.");
    }
    setPlayback(options: { audio: boolean; video: boolean; }): Promise<void> {
        throw new Error("Method not implemented.");
    }
}

export class TuyaCamera extends ScryptedDeviceBase implements DeviceProvider, VideoCamera, BinarySensor, MotionSensor, OnOff, Online, RTCSignalingChannel {
    private cameraLightSwitch?: TuyaCameraLight
    private previousMotion?: any;
    private previousDoorbellRing?: any;
    private motionTimeout?: NodeJS.Timeout;
    private binaryTimeout: NodeJS.Timeout;

    constructor(
        public controller: TuyaController,
        nativeId: string
    ) {
        super(nativeId);
    }

    // Camera Light Device Provider.

    getDevice(nativeId: string) {
        // Find created devices
        if (this.cameraLightSwitch?.id === nativeId) {
            return this.cameraLightSwitch;
        }

        // Create devices if not found.
        if (nativeId === this.nativeLightSwitchId) {
            this.cameraLightSwitch = new TuyaCameraLight(this, nativeId);
            return this.cameraLightSwitch;
        }

        throw new Error("This Camera Device Provider has not been implemented of type: " + nativeId.split('-')[1]);
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
            this.logger.e(`Could not find camera for ${this.name} to show stream.`);
            throw new Error(`Failed to stream ${this.name}: Camera not found.`);
        }

        if (!camera.online) {
            this.logger.e(`${this.name} is currently offline. Will not be able to stream until device is back online.`);
            throw new Error(`Failed to stream ${this.name}: Camera is offline.`);
        }

        const rtsps = await this.controller.cloud?.getRTSPS(camera);

        if (!rtsps) {
            this.logger.e("There was an error retreiving camera's rtsps for streamimg.");
            throw new Error(`Failed to capture stream for ${this.name}: RTSPS link not found.`);
        }

        const mediaStreamUrl: MediaStreamUrl = {
            url: rtsps.url,
            container: 'rtsp',
            mediaStreamOptions: vso
        }
        return this.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
    }

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        const camera = this.findCamera();

        if (!camera) {
            this.logger.e(`Could not find camera for ${this.name} to create rtc signal session.`);
            throw new Error(`Failed to create rtc config for ${this.name}: Camera not found.`);
        }

        const deviceWebRTConfigResponse = await this.controller.cloud?.getDeviceWebRTConfig(camera);

        if (!deviceWebRTConfigResponse?.success) {
            this.logger.e(`[${this.name}] There was an error retrieving WebRTConfig.`);
            throw new Error(`Failed to create device rtc config for ${this.name}: request failed: ${deviceWebRTConfigResponse?.result}.`);
        }

        const deviceWebRTConfig = deviceWebRTConfigResponse.result;

        let mqResponse = await this.controller.cloud?.getWebRTCMQConfig(deviceWebRTConfig);
        if (!mqResponse?.success) {
            this.logger.e(`[${this.name}] There was an error retrieving WebRTC MQTT RTC Config.`);
            throw new Error(`Failed to create rtc mqtt config for ${this.name}: request failed: ${mqResponse?.result}.`);
        }

        const mqttWebRTConfig = mqResponse.result;

        // const mqttRTC = new TuyaMQ(mqttWebRTConfig);
        // mqttRTC.start();    

        //// Type of signals it accepts for audio and video qualities
        // const skill = JSON.parse(webRTConfig.skill);

        const offerSetup: RTCAVSignalingSetup = {
            type: "offer",
            audio: {
                direction: 'sendrecv',
            },
            video: {
                direction: 'recvonly',
            },
        }

        // Calls getOptions, setRemoteDescription, 
        const answerSession: RTCSignalingSession = {
            createLocalDescription: async (type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> => {
                throw new Error("Function not implemented.");
            },
            setRemoteDescription: async (description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> => {
                // throw new Error("Function not implemented.");
            },
            addIceCandidate: async (candidate: RTCIceCandidateInit): Promise<void> => {
                throw new Error("Function not implemented.");
            },
            getOptions: async (): Promise<RTCSignalingOptions> => {
                return {
                    requiresOffer: true,
                    disableTrickle: false
                };
            }
        }

        const answerSetup: Partial<RTCAVSignalingSetup> = {
        }

        await connectRTCSignalingClients(this.console, session, offerSetup, answerSession, answerSetup);

        return new TuyaRTCSessionControl(deviceWebRTConfig);
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
                tool: 'scrypted'
            }
        ];
    }

    // Motion

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.

    triggerBinaryState() {
        clearTimeout(this.binaryTimeout);
        this.binaryState = true;
        this.binaryTimeout = setTimeout(() => {
            this.binaryState = false;
        }, 10 * 1000);
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

        this.online = camera.online;

        if (TuyaDevice.hasStatusIndicator(camera)) {
            this.on = TuyaDevice.getStatusIndicator(camera)?.value;
        }

        if (TuyaDevice.hasMotionDetection(camera)) {
            const motionDetectedStatus = TuyaDevice.getMotionDetectionStatus(camera);
            if (motionDetectedStatus) {
                if (!this.previousMotion) {
                    this.previousMotion = motionDetectedStatus.value;
                } else if (this.previousMotion !== motionDetectedStatus.value) {
                    this.previousMotion = motionDetectedStatus.value;
                    this.triggerMotion();
                }
            }
        }

        if (TuyaDevice.isDoorbell(camera)) {
            const doorbellRingStatus = TuyaDevice.getDoorbellRing(camera);
            if (doorbellRingStatus) {
                if (!this.previousDoorbellRing) {
                    this.previousDoorbellRing = doorbellRingStatus.value;
                } else if (this.previousDoorbellRing !== doorbellRingStatus.value) {
                    this.previousDoorbellRing = doorbellRingStatus.value;
                    this.triggerBinaryState();
                }
            }
        }

        // By the time this is called, scrypted would have already reported the device
        // Only set light switch on cameras that have a status light indicator.

        if (TuyaDevice.hasLightSwitch(camera)) {
            this.getDevice(this.nativeLightSwitchId)?.updateState(camera);
        }
    }

    private get nativeLightSwitchId(): string {
        return `${this.nativeId}-light`;
    }

    private get logger(): Logger {
        return deviceManager.getDeviceLogger(this.nativeId);
    }
}
