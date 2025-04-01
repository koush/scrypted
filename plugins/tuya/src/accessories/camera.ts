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
import { TuyaDeviceStatus } from "../tuya/const";

// TODO: Allow setting motion info based on dp name?
const SCHEMA_CODE = {
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

export class TuyaCamera extends TuyaAccessory implements DeviceProvider, VideoCamera, BinarySensor, MotionSensor, OnOff {
  private lightAccessory: ScryptedDeviceBase | undefined;

  get deviceSpecs(): Device {
    const indicatorSchema = !!this.getSchema(...SCHEMA_CODE.INDICATOR);
    const motionSchema = !!this.getSchema(...SCHEMA_CODE.MOTION_ON);
    const doorbellSchema = !!this.getSchema(...SCHEMA_CODE.DOORBELL) && !!this.getSchema(...SCHEMA_CODE.ALARM_MESSAGE, ...SCHEMA_CODE.DOORBELL_RING);

    return {
      ...super.deviceSpecs,
      type: doorbellSchema ? ScryptedDeviceType.Doorbell : ScryptedDeviceType.Camera,
      interfaces: [
        ...super.deviceSpecs.interfaces,
        ScryptedInterface.VideoCamera,
        ScryptedInterface.DeviceProvider,
        indicatorSchema ? ScryptedInterface.OnOff : null,
        motionSchema ? ScryptedInterface.MotionSensor : null,
        doorbellSchema ? ScryptedInterface.BinarySensor : null,
      ]
      .filter((p): p is ScryptedInterface => !!p)
    }
  }

  async getDevice(nativeId: ScryptedNativeId) {
    if (nativeId === this.nativeId + "-light") {
      return this.lightAccessory;
    } else {
      throw new Error("Light not found")
    }
  }

  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> { }

  // OnOff Status Indicator
  async turnOff(): Promise<void> {
    const indicatorSchema = this.getSchema(...SCHEMA_CODE.INDICATOR);
    if (!indicatorSchema || indicatorSchema.mode == "r") return;
    await this.sendCommands({ code: indicatorSchema.code, value: false })
  }

  async turnOn(): Promise<void> {
    const indicatorSchema = this.getSchema(...SCHEMA_CODE.INDICATOR);
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

  async updateStatus(status: TuyaDeviceStatus[]): Promise<void> {
    const indicatorSchema = this.getSchema(...SCHEMA_CODE.INDICATOR);
    if (indicatorSchema) this.on = this.getStatus(indicatorSchema.code)?.value == true;

    const motionSchema = this.getSchema(...SCHEMA_CODE.MOTION_DETECT);
    if (this.getSchema(...SCHEMA_CODE.MOTION_ON) && motionSchema) {
      const motionStatus = status.find(s => s.code == motionSchema.code);
      motionStatus && motionStatus.value.toString().length > 1 && this.debounce(
        motionSchema,
        10 * 1000,
        () => this.motionDetected = true, 
        () => this.motionDetected = false,
      )
    }

    const doorbellNotifSchema = this.getSchema(...SCHEMA_CODE.ALARM_MESSAGE, ...SCHEMA_CODE.DOORBELL_RING);
    if (this.getSchema(...SCHEMA_CODE.DOORBELL) && doorbellNotifSchema) {
      const doorbellStatus = status.find(s => [...SCHEMA_CODE.ALARM_MESSAGE, ...SCHEMA_CODE.DOORBELL_RING].includes(s.code));
      doorbellStatus && doorbellStatus.value.toString().length > 1 && this.debounce(
        doorbellNotifSchema,
        10 * 1000,
        () => this.binaryState = true, 
        () => this.binaryState = false
      );
    }

    const lightSchema = this.getSchema(...SCHEMA_CODE.LIGHT_ON);
    if (lightSchema) {
      const plugin = this.plugin;
      const deviceId = this.tuyaDevice.id;

      if (!this.lightAccessory) {
        this.lightAccessory = Object.assign(
          new ScryptedDeviceBase(this.tuyaDevice.id + "-light"),
          {
            turnOff: async function () {
              await plugin.api?.sendCommands(deviceId, [{ code: lightSchema.code, value: false }])
            },
            turnOn: async function () {
              await plugin.api?.sendCommands(deviceId, [{ code: lightSchema.code, value: true }])
            },
          } satisfies OnOff & Online
        );

        await sdk.deviceManager.onDeviceDiscovered(
          {
            providerNativeId: this.tuyaDevice.id,
            name: this.tuyaDevice.name + " Light",
            nativeId: this.lightAccessory.nativeId,
            info: this.deviceSpecs.info,
            type: ScryptedDeviceType.Light,
            interfaces: [
              ScryptedInterface.OnOff,
              ScryptedInterface.Online
            ]
          }
        )
      }

      const lightStatus = status.find(s => s.code === lightSchema.code);
      lightStatus && (this.lightAccessory.on = !!lightStatus.value)
    }
  }
}