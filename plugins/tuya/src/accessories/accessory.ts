import { DeviceProvider, Online, Device as ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId } from "@scrypted/sdk";
import { TuyaPlugin } from "../plugin";
import { TuyaDevice, TuyaDeviceSchema, TuyaDeviceStatus } from "../tuya/const";

type Debounced = {
}

export abstract class TuyaAccessory extends ScryptedDeviceBase implements Online {
  tuyaDevice: TuyaDevice;
  plugin: TuyaPlugin;

  private debounced = new Map<string, NodeJS.Timeout>();

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

  async updateAllValues(): Promise<void> {
    this.online = this.tuyaDevice.online;
    await this.updateStatus(this.tuyaDevice.status);
  }

  async updateStatus(status: TuyaDeviceStatus[]): Promise<void> {
    for (const stat of status) {
      const old = this.tuyaDevice.status.find(o => o.code === stat.code);
      if (old) {
        old.value = stat.value;
      } else {
        this.tuyaDevice.status = [...this.tuyaDevice.status, stat];
      }
    }
  }

  protected debounce(
    schema: TuyaDeviceSchema,
    duration: number,
    initial: () => void,
    timeout: () => void
  ) {
    const prevDebouncing = this.debounced.get(schema.code);
    if (prevDebouncing) {
      clearTimeout(prevDebouncing);
      this.debounced.delete(schema.code);
    } else {
      initial();
    }

    this.debounced.set(
      schema.code,
      setTimeout(() => { timeout(); this.debounced.delete(schema.code); }, duration)
    )
  }
}