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
  Device,
  ScryptedDeviceType,
  ScryptedInterface,
} from "@scrypted/sdk";
import { TuyaAccessory } from "./accessory";

export class TuyaCamera extends TuyaAccessory implements VideoCamera, BinarySensor, MotionSensor, OnOff {
  private static SCHEMA_CODE = {
    MOTION_ON: ['motion_switch', 'pir_sensitivity', 'motion_sensitivity'],
    MOTION_DETECT: ['movement_detect_pic'],
    // Indicates that this is possibly a doorbell
    DOORBELL: ['doorbell_ring_exist'],
    // Notifies when a doorbell ring occurs.
    DOORBELL_RING: ['doorbell_pic'],
    // Notifies when a doorbell ring or motion occurs.
    ALARM_MESSAGE: ['alarm_message'],
    LIGHT_ON: ['floodlight_switch'],
    LIGHT_BRIGHT: ['floodlight_lightness'],
    INDICATOR: ["basic_indicator"]
  };

  // private lightSwitch?: TuyaCameraLight;
  // private previousMotion?: any;
  // private previousDoorbellRing?: any;
  // private motionTimeout?: NodeJS.Timeout;
  // private binaryTimeout?: NodeJS.Timeout;

  get deviceSpecs(): Device {
    const indicatorSchema = this.getSchema(...TuyaCamera.SCHEMA_CODE.INDICATOR);
    const motionSchema = this.getSchema(...TuyaCamera.SCHEMA_CODE.MOTION_ON);

    return {
      ...super.deviceSpecs,
      type: ScryptedDeviceType.Camera,
      interfaces: [
        ...super.deviceSpecs.interfaces,
        ScryptedInterface.VideoCamera,
        !!indicatorSchema ? ScryptedInterface.OnOff : null,
        !!motionSchema ? ScryptedInterface.MotionSensor : null
        // ScryptedInterface.DeviceProvider
      ]
      .filter((p): p is ScryptedInterface => !!p)
    }
  }

  // OnOff Status Indicator
  async turnOff(): Promise<void> {
    const indicatorSchema = this.getSchema(...TuyaCamera.SCHEMA_CODE.INDICATOR);
    if (!indicatorSchema || indicatorSchema.mode == "r") return;
    await this.sendCommands({ code: indicatorSchema.code, value: false })
  }

  async turnOn(): Promise<void> {
    const indicatorSchema = this.getSchema(...TuyaCamera.SCHEMA_CODE.INDICATOR);
    if (!indicatorSchema || indicatorSchema.mode == "r") return;
    await this.sendCommands({ code: indicatorSchema.code, value: true })
  }

  // Video Camera
  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    // Always create new rtsp since it can only be used once and we only have 30 seconds before we can
    // use it.
    if (!this.tuyaDevice.online) {
      this.log.e(`${this.name} is currently offline. Will not be able to stream until device is back online.`);
      throw new Error(`Failed to stream ${this.name}: Camera is offline.`);
    }

    const rtsps = await this.plugin.api?.getRTSP(this.tuyaDevice.id);

    if (!rtsps) {
      this.log.e("There was an error retreiving camera's live feed camera feed.");
      throw new Error(`Failed to capture stream for ${this.name}: RTSPS link not found.`);
    }

    return this.createMediaObject(
      {
        url: rtsps.url,
        container: "rtsp",
        mediaStreamOptions: (await this.getVideoStreamOptions())[0],
      } satisfies MediaStreamUrl,
      ScryptedMimeTypes.MediaStreamUrl
    );
  }

  async getVideoStreamOptions(): Promise<[ResponseMediaStreamOptions]> {
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

  updateAllValues() {
    super.updateAllValues();

    const indicatorSchema = this.getSchema(...TuyaCamera.SCHEMA_CODE.INDICATOR);
    if (indicatorSchema) this.on = !!this.getStatus(indicatorSchema?.code)?.value;

    // const motionDetection = this.getSchema(...TuyaCamera.SCHEMA_CODE.MOTION_DETECT);
    // if (motionDetection) this.motionDetected
  }

  /// Motion

  // most cameras have have motion and doorbell press events, but dont notify when the event ends.
  // so set a timeout ourselves to reset the state.
  // triggerBinaryState() {
  //   clearTimeout(this.binaryTimeout);
  //   this.binaryState = true;
  //   this.binaryTimeout = setTimeout(() => {
  //     this.binaryState = false;
  //   }, 10 * 1000);
  // }

  // This will trigger a motion detected alert if it has no timeout. If there is a timeout, then
  // it will restart the timeout in order to turn off motion detected
  // triggerMotion() {
  //   const timeoutCallback = () => {
  //     this.motionDetected = false;
  //     this.motionTimeout = undefined;
  //   };
  //   if (!this.motionTimeout) {
  //     this.motionTimeout = setTimeout(timeoutCallback, 10 * 1000);
  //     this.motionDetected = true;
  //   } else {
  //     // Cancel the timeout and start again.
  //     clearTimeout(this.motionTimeout);
  //     this.motionTimeout = setTimeout(timeoutCallback, 10 * 1000);
  //   }
  // }

  // updateState(device: TuyaDeviceConfig) {
    // camera = camera || this.findCamera();

    // if (!camera) {
      // return;
    // }

    // this.online = camera.online;

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
  // }

  // private get nativeLightSwitchId(): string {
  //   return `${this.nativeId}-light`;
  // }
}

// class TuyaCameraLight extends ScryptedDeviceBase implements OnOff, Online {
//   private camera: TuyaCamera;

//   constructor(nativeId: string, camera: TuyaCamera) {
//     super(nativeId);
//     this.camera = camera;
//   }

//   async turnOff(): Promise<void> {
//     await this.setLightSwitch(false);
//   }

//   async turnOn(): Promise<void> {
//     await this.setLightSwitch(true);
//   }

//   private async setLightSwitch(on: boolean) {
//     // const lightSwitchStatus = TuyaDevice.getLightSwitchStatus(camera);

//     // if (camera.online && lightSwitchStatus) {
//     //   await this.camera.controller.api.updateDevice(camera, [
//     //     {
//     //       code: lightSwitchStatus.code,
//     //       value: on,
//     //     },
//     //   ]);
//     // }
//   }

//   // updateState(device?: TuyaDeviceConfig) {
//     // if (!device) return;

//     // this.on = TuyaDevice.getLightSwitchStatus(camera)?.value;
//     // this.online = device.online;
//   // }
// }