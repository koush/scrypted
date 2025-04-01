import { Online, Device as ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { TuyaPlugin } from "../plugin";
import { TuyaDevice, TuyaDeviceStatus } from "../tuya/const";

export abstract class TuyaAccessory extends ScryptedDeviceBase implements Online {
  tuyaDevice: TuyaDevice;
  plugin: TuyaPlugin;

  get deviceSpecs(): ScryptedDevice {
    return {
      name: this.tuyaDevice.name,
      nativeId: this.tuyaDevice.id,
      info: {
        model: this.tuyaDevice.model || this.tuyaDevice.product_name || this.tuyaDevice.product_id,
        manufacturer: "Tuya Inc.",
        serialNumber: this.tuyaDevice.uuid,
      },
      type: ScryptedDeviceType.Unknown,
      interfaces: [ScryptedInterface.Online]
    }
  }

  constructor(state: TuyaDevice, controller: TuyaPlugin) {
    super(state.id);
    this.tuyaDevice = state;
    this.plugin = controller;
    this.updateAllValues();
  }

  getStatus(code: string) {
    return this.tuyaDevice.status.find(s => s.code === code);
  }

  getSchema(...codes: string[]) {
    for (const code of codes) {
      const schema = this.tuyaDevice.schema.find(s => s.code === code);
      if (!schema || schema.mode === "w") continue;
      return schema;
    }
  }

  async sendCommands(...commands: TuyaDeviceStatus[]): Promise<void> {
    if (!commands.length) return;
    await this.plugin.api?.sendCommands(this.tuyaDevice.id, commands);
  }

  updateAllValues() {
    this.online = this.tuyaDevice.online;
  }
}