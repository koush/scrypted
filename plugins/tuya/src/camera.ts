import sdk, {
  ScryptedDeviceBase,
  VideoCamera,
  MotionSensor,
  BinarySensor,
  MediaObject,
  MediaStreamOptions,
  MediaStreamUrl,
  ScryptedMimeTypes,
  ResponseMediaStreamOptions,
  OnOff,
  DeviceProvider,
  Online,
  Logger,
  Intercom,
  ScryptedNativeId,
} from "@scrypted/sdk";
import { TuyaPlugin } from "./plugin";
import { TuyaDeviceConfig } from "./tuya/const";
const { deviceManager } = sdk;

export class TuyaCameraLight extends ScryptedDeviceBase implements OnOff, Online {
  private camera: TuyaCamera;

  constructor(nativeId: string, camera: TuyaCamera) {
    super(nativeId);
    this.camera = camera;
  }

  async turnOff(): Promise<void> {
    await this.setLightSwitch(false);
  }

  async turnOn(): Promise<void> {
    await this.setLightSwitch(true);
  }

  private async setLightSwitch(on: boolean) {
    // const camera = this.camera.findCamera();

    // if (!camera) {
    //   this.log.w(`Camera was not found for ${this.name}`);
    //   return;
    // }

    // const lightSwitchStatus = TuyaDevice.getLightSwitchStatus(camera);

    // if (camera.online && lightSwitchStatus) {
    //   await this.camera.controller.api.updateDevice(camera, [
    //     {
    //       code: lightSwitchStatus.code,
    //       value: on,
    //     },
    //   ]);
    // }
  }

  updateState(camera?: TuyaDeviceConfig) {
    camera = camera || this.camera.findCamera();
    if (!camera) return;

    // this.on = TuyaDevice.getLightSwitchStatus(camera)?.value;
    this.online = camera.online;
  }
}

export class TuyaCamera extends ScryptedDeviceBase implements DeviceProvider, VideoCamera, BinarySensor, MotionSensor, OnOff, Online {
  private deviceConfig: TuyaDeviceConfig
  private controller: TuyaPlugin;

  private lightSwitch?: TuyaCameraLight;
  private previousMotion?: any;
  private previousDoorbellRing?: any;
  private motionTimeout?: NodeJS.Timeout;
  private binaryTimeout?: NodeJS.Timeout;

  constructor(deviceConfig: TuyaDeviceConfig, controller: TuyaPlugin) {
    super(deviceConfig.id);
    this.deviceConfig = deviceConfig;
    this.controller = controller
  }

  // Camera Light Device Provider.

  async getDevice(nativeId: ScryptedNativeId): Promise<TuyaCameraLight> {
    // Find created devices
    if (this.lightSwitch && this.lightSwitch.id === nativeId) {
      return this.lightSwitch;
    }

    // Create devices if not found.
    if (nativeId === this.nativeLightSwitchId) {
      this.lightSwitch = new TuyaCameraLight(nativeId, this);
      return this.lightSwitch;
    }

    throw new Error(
      "This Camera Device Provider has not been implemented of type: " +
      nativeId?.split("-")[1]
    );
  }

  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {

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

    // const statusIndicator = TuyaDevice.getStatusIndicator(camera);

    // if (statusIndicator) {
    //   await this.controller.api?.updateDevice(camera.id, [
    //     {
    //       code: statusIndicator.code,
    //       value: on,
    //     },
    //   ]);
    // }
  }

  // VideoCamera

  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    const vso = (await this.getVideoStreamOptions())[0];

    // Always create new rtsp since it can only be used once and we only have 30 seconds before we can
    // use it.

    if (!this.deviceConfig) {
      this.logger.e(`Could not find camera for ${this.name} to show stream.`);
      throw new Error(`Failed to stream ${this.name}: Camera not found.`);
    }

    if (!this.deviceConfig.online) {
      this.logger.e(
        `${this.name} is currently offline. Will not be able to stream until device is back online.`
      );
      throw new Error(`Failed to stream ${this.name}: Camera is offline.`);
    }

    const rtsps = await this.controller.api?.getRTSP(this.deviceConfig.id);

    if (!rtsps) {
      this.logger.e(
        "There was an error retreiving camera's rtsps for streamimg."
      );
      throw new Error(
        `Failed to capture stream for ${this.name}: RTSPS link not found.`
      );
    }

    const mediaStreamUrl: MediaStreamUrl = {
      url: rtsps.url,
      container: "rtsp",
      mediaStreamOptions: vso,
    };
    return this.createMediaObject(
      mediaStreamUrl,
      ScryptedMimeTypes.MediaStreamUrl
    );
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    return [
      {
        id: "cloud-rtsp",
        name: "Cloud RTSP",
        container: "rtsp",
        video: {
          codec: "h264",
        },
        audio: {
          codec: "pcm_ulaw",
        },
        source: "cloud",
        tool: "ffmpeg",
      },
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
    };
    if (!this.motionTimeout) {
      this.motionTimeout = setTimeout(timeoutCallback, 10 * 1000);
      this.motionDetected = true;
    } else {
      // Cancel the timeout and start again.
      clearTimeout(this.motionTimeout);
      this.motionTimeout = setTimeout(timeoutCallback, 10 * 1000);
    }
  }

  findCamera(): TuyaDeviceConfig | undefined {
    return undefined;
  }

  updateState(camera?: TuyaDeviceConfig) {
    camera = camera || this.findCamera();

    if (!camera) {
      return;
    }

    this.online = camera.online;

    // if (TuyaDevice.hasStatusIndicator(camera)) {
    //   this.on = TuyaDevice.getStatusIndicator(camera)?.value;
    // }

    // if (TuyaDevice.hasMotionDetection(camera)) {
    //   const motionDetectedStatus = TuyaDevice.getMotionDetectionStatus(camera);
    //   if (motionDetectedStatus) {
    //     if (!this.previousMotion) {
    //       this.previousMotion = motionDetectedStatus.value;
    //     } else if (this.previousMotion !== motionDetectedStatus.value) {
    //       this.previousMotion = motionDetectedStatus.value;
    //       this.triggerMotion();
    //     }
    //   }
    // }

    // if (TuyaDevice.isDoorbell(camera)) {
    //   const doorbellRingStatus = TuyaDevice.getDoorbellRing(camera);
    //   if (doorbellRingStatus) {
    //     if (!this.previousDoorbellRing) {
    //       this.previousDoorbellRing = doorbellRingStatus.value;
    //     } else if (this.previousDoorbellRing !== doorbellRingStatus.value) {
    //       this.previousDoorbellRing = doorbellRingStatus.value;
    //       this.triggerBinaryState();
    //     }
    //   }
    // }

    // // By the time this is called, scrypted would have already reported the device
    // // Only set light switch on cameras that have a light switch.

    // if (TuyaDevice.hasLightSwitch(camera)) {
    //   // this.getDevice(this.nativeLightSwitchId)?.updateState(camera);
    // }
  }

  private get nativeLightSwitchId(): string {
    return `${this.nativeId}-light`;
  }

  private get logger(): Logger {
    return deviceManager.getDeviceLogger(this.nativeId);
  }
}