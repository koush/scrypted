import {
  AdoptDevice,
  Device,
  DeviceDiscovery,
  DeviceProvider,
  DiscoveredDevice,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  ScryptedNativeId,
  Setting,
  Settings,
} from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import { TuyaCloud } from "./tuya/cloud";
import { TuyaDevice } from "./tuya/device";
import { TuyaCamera } from "./camera";
import { getTuyaPulsarEndpoint, TUYA_COUNTRIES } from "./tuya/utils";
import { TuyaPulsar, TuyaPulsarMessage } from "./tuya/pulsar";
import { TuyaCloudConfig, TuyaManager } from "./tuya/manager";

const { deviceManager } = sdk;

export class TuyaPlugin
  extends ScryptedDeviceBase
  implements DeviceProvider, DeviceDiscovery, Settings
{
  manager: TuyaManager;

  constructor(nativeId?: string) {
    super(nativeId);
    this.manager = new TuyaManager(this.console);
    
    // const config = this.cloudConfig;
    // if (config) {
    //   this.manager.discoverDevices(config);
    // }
  }

  discoverDevices(scan?: boolean): Promise<DiscoveredDevice[]> {
    if (this.cloudConfig) this.manager.discoverDevices(this.cloudConfig);
    return Promise.reject()
  }
  
  getDevice(nativeId: ScryptedNativeId): Promise<TuyaCamera | undefined> {
    if (nativeId) {
      return this.manager.getDevice(nativeId);
    } else {
      return Promise.resolve(undefined);
    }
  }
  
  adoptDevice(device: AdoptDevice): Promise<string> {
    throw new Error("Method not implemented.");
  }

  releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {
    throw new Error("Method not implemented.");
  }

  // Settings

  async getSettings(): Promise<Setting[]> {
    return [
      {
        key: "userId",
        title: "User Id",
        description:
          "Required: You can find this information in Tuya IoT -> Cloud -> Devices -> Linked Devices.",
        value: this.getSetting("userId"),
      },
      {
        key: "accessId",
        title: "Access Id",
        description: "Requirerd: This is located on the main project.",
        value: this.getSetting("accessId"),
      },
      {
        key: "accessKey",
        title: "Access Key/Secret",
        description: "Requirerd: This is located on the main project.",
        type: "password",
        value: this.getSetting("accessKey"),
      },
      {
        key: "country",
        title: "Country",
        description:
          "Required: This is the country where you registered your devices.",
        type: "string",
        choices: TUYA_COUNTRIES.map((value) => value.country),
        value: this.getSetting("country"),
      },
    ];
  }

  getSetting(key: string): string | null {
    return this.storage.getItem(key);
  }

  async putSetting(key: string, value: string): Promise<void> {
    this.storage.setItem(key, value);
    if (!this.cloudConfig) return;
    this.manager.discoverDevices(this.cloudConfig);
  }

  get cloudConfig(): TuyaCloudConfig | undefined {
    const userId = this.getSetting("userId");
    const accessId = this.getSetting("accessId");
    const accessKey = this.getSetting("accessKey");
    const country = TUYA_COUNTRIES.find(
      (value) => value.country == this.getSetting("country")
    );

    this.log.clearAlerts();

    let missingItems: string[] = [];

    if (!userId) missingItems.push("User Id");

    if (!accessId) missingItems.push("Access Id");

    if (!accessKey) missingItems.push("Access Key");

    if (!country) missingItems.push("Country");

    if (missingItems.length > 0) {
      this.log.a(`You must provide your ${missingItems.join(", ")}.`);
      return;
    }
  }
}