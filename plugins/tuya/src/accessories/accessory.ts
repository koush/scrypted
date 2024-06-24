import { ScryptedDeviceBase } from "@scrypted/sdk";
import { TuyaDeviceConfig } from "../tuya/const";

export class TuyaBaseAccessory extends ScryptedDeviceBase {
  async updateState(config: TuyaDeviceConfig) {
    // Base Acessory status update
    this.online = false
  }
};