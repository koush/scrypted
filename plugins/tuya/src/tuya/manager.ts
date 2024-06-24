import { Logger } from "@scrypted/sdk";
import { TuyaCamera } from "../camera";
import { TuyaCloud } from "./cloud";
import { TuyaPulsar, TuyaPulsarMessage } from "./pulsar";
import { getTuyaPulsarEndpoint, TuyaSupportedCountry } from "./utils";

export type TuyaCloudConfig = {
  userId: string;
  accessId: string;
  accessKey: string;
  country: TuyaSupportedCountry;
}

export class TuyaManager {
  cloud: TuyaCloud;
  pulsar: TuyaPulsar;
  devices: Map<string, TuyaCamera> = new Map();

  constructor(
    readonly console: Console
  ) {
    this.console = console;
  }
  
  private handlePulsarMessage(message: TuyaPulsarMessage) {
    const data = message.payload.data;
    const { devId, productKey } = data;
    let refreshDevice = false;

    const device = this.cloud?.cameras?.find((c) => c.id === devId);

    let pulsarMessageLogs: string[] = ["Received new TuyaPulsar Message:"];

    if (data.bizCode) {
      if (device && (data.bizCode === "online" || data.bizCode === "offline")) {
        // Device status changed
        const isOnline = data.bizCode === "online";
        device.online = isOnline;
        refreshDevice = true;
        pulsarMessageLogs.push(
          `- Changed device to ${data.bizCode} for ${device.name}`
        );
      } else if (device && data.bizCode === "delete") {
        // Device needs to be deleted
        // - devId
        // - uid

        pulsarMessageLogs.push(`- Delete ${device.name} from homekit`);
        const { uid } = data.bizData;
        // TODO: delete device
      } else if (data.bizCode === "add") {
        // TODO: There is a new device added, refetch
        pulsarMessageLogs.push(
          `- Add new device with devId: ${data.devId} to homekit`
        );
      } else {
        pulsarMessageLogs.push(
          `- Unknown bizCode: ${data.bizCode} with data: ${JSON.stringify(
            data.bizData
          )}.`
        );
      }
    } else if (device && data.status) {
      const newStatus = data.status || [];

      pulsarMessageLogs.push(`- ${device.name} received new status updates:`);

      newStatus.forEach((item) => {
        pulsarMessageLogs.push(`\t- ${JSON.stringify(item)}`);

        const index = device.status.findIndex(
          (status) => status.code == item.code
        );
        if (index !== -1) {
          device.status[index].value = item.value;
        }
      });

      refreshDevice = true;
    } else {
      pulsarMessageLogs.push(
        `- Unknown TuyaPulsar message received: ${JSON.stringify(data)}`
      );
    }

    pulsarMessageLogs.push("");
    this.console.debug(pulsarMessageLogs.join("\n"));

    if (refreshDevice) {
      return this.devices.get(devId);
    }
  }

  async discoverDevices(config: TuyaCloudConfig): Promise<DiscoveredDevice[]> {
    if (!this.cloud) {
      this.cloud = new TuyaCloud(
        config.userId, 
        config.accessId, 
        config.accessKey, 
        config.country
      );
    }

    // If it cannot fetch devices, then that means it's permission denied.
    // For some reason, when generating a token does not validate authorization.
    if (!(await this.cloud.fetchDevices())) {
      // this.log.a("Failed to log in with credentials. Please try again.");
      this.cloud = null;
      return;
    }

    // this.log.a(
      // "Successsfully logged in with credentials! Now discovering devices."
    // );

    if (this.pulsar) {
      this.pulsar.stop();
    }

    this.pulsar = new TuyaPulsar({
      accessId: config.accessId,
      accessKey: config.accessKey,
      url: getTuyaPulsarEndpoint(config.country),
    });

    this.pulsar.open(() => {
      this.console.log(`TulsaPulse: opened connection.`);
    });

    this.pulsar.message((ws, message) => {
      this.pulsar?.ackMessage(message.messageId);
      const tuyaDevice = this.handlePulsarMessage(message);
      if (!tuyaDevice) return;
      tuyaDevice.updateState();
    });

    this.pulsar.reconnect(() => {
      this.console.info(`TuyaPulse: restarting connection.`);
    });

    this.pulsar.close((ws, ...args) => {
      this.console.info(`TuyaPulse: closed connection.`);
    });

    this.pulsar.error((ws, error) => {
      this.console.error(`TuyaPulse: ${error}`);
    });

    this.pulsar.maxRetries(() => {
      this.console.error(
        "There was an error trying to connect to Message Service (TuyaPulse). Connection Max Reconnection Timed Out"
      );
    });

    this.pulsar.start();

    // Find devices

    // const devices: Device[] = [];

    // // Camera Setup

    // for (const camera of this.cloud.cameras || []) {
    //   const nativeId = camera.id;

    //   const device: Device = {
    //     providerNativeId: this.nativeId,
    //     name: camera.name,
    //     nativeId,
    //     info: {
    //       manufacturer: "Tuya",
    //       model: camera.model,
    //       serialNumber: nativeId,
    //     },
    //     type: TuyaDevice.isDoorbell(camera)
    //       ? ScryptedDeviceType.Doorbell
    //       : ScryptedDeviceType.Camera,
    //     interfaces: [ScryptedInterface.VideoCamera, ScryptedInterface.Online],
    //   };

    //   let deviceInfo: string[] = [
    //     `Creating camera device for: \n- ${camera.name}`,
    //   ];

    //   if (TuyaDevice.isDoorbell(camera)) {
    //     deviceInfo.push(`- Detected as a Doorbell`);
    //     device.interfaces.push(ScryptedInterface.BinarySensor);
    //   }

    //   if (TuyaDevice.hasStatusIndicator(camera)) {
    //     deviceInfo.push(`- Has Status Indicator`);
    //     device.interfaces.push(ScryptedInterface.OnOff);
    //   }

    //   if (TuyaDevice.hasMotionDetection(camera)) {
    //     deviceInfo.push(`- Motion Detection Supported`);
    //     device.interfaces.push(ScryptedInterface.MotionSensor);
    //   }

    //   // TODO: Wait until Tuya implements better security auth
    //   // if (await TuyaDevice.supportsWebRTC(camera, this.cloud)) {
    //   //     deviceInfo.push(`- WebRTC Supported with Intercom`);
    //   //     device.interfaces.push(ScryptedInterface.RTCSignalingChannel);
    //   // }

    //   // Device Provider

    //   if (TuyaDevice.hasLightSwitch(camera)) {
    //     deviceInfo.push(`- Has Light Switch`);
    //     device.interfaces.push(ScryptedInterface.DeviceProvider);
    //   }

    //   deviceInfo.push(`- Status:`);
    //   for (let status of camera.status) {
    //     deviceInfo.push(`\t${status.code}: ${status.value}`);
    //   }

    //   deviceInfo.push(`- Functions:`);
    //   for (let func of camera.functions) {
    //     deviceInfo.push(`\t${func.code}`);
    //   }

    //   deviceInfo.push(``);
    //   this.log.i(deviceInfo.join("\n\t"));

    //   devices.push(device);
    // }

    // await deviceManager.onDevicesChanged({
    //   providerNativeId: this.nativeId,
    //   devices,
    // });

    // // Handle any camera device that have a light switch

    // for (const camera of this.cloud.cameras || []) {
    //   if (!TuyaDevice.hasLightSwitch(camera)) continue;
    //   const nativeId = camera.id + "-light";
    //   const device: Device = {
    //     providerNativeId: camera.id,
    //     name: camera.name + " Light",
    //     nativeId,
    //     info: {
    //       manufacturer: "Tuya",
    //       model: camera.model,
    //       serialNumber: camera.id,
    //     },
    //     interfaces: [ScryptedInterface.OnOff, ScryptedInterface.Online],
    //     type: ScryptedDeviceType.Light,
    //   };

    //   await deviceManager.onDevicesChanged({
    //     providerNativeId: camera.id,
    //     devices: [device],
    //   });
    // }

    // // Update devices with new state

    // for (const device of devices) {
    //   await this.getDevice(device.nativeId).then((device) =>
    //     device?.updateState()
    //   );
    // }
  }

  async getDevice(nativeId: string) {
    if (this.devices.has(nativeId)) {
      return this.devices.get(nativeId);
    }

    const camera = this.cloud?.cameras?.find(
      (camera) => camera.id === nativeId
    );
    if (camera) {
      const ret = new TuyaCamera(this, nativeId);
      this.devices.set(nativeId, ret);
      return ret;
    }

    throw new Error("device not found?");
  }
}