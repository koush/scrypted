import { Brightness, OnOff, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { HikvisionCamera } from "./main";

export class HikvisionSupplementalLight extends ScryptedDeviceBase implements OnOff, Brightness, Settings {
    storageSettings = new StorageSettings(this, {
        mode: {
            title: 'Mode',
            description: 'Choose "auto" for automatic brightness control or "manual" for custom brightness.',
            defaultValue: 'auto',
            type: 'string',
            choices: ['auto', 'manual'],
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        brightness: {
            title: 'Manual Brightness',
            description: 'Set brightness (0–100) when in manual mode.',
            defaultValue: 100,
            type: 'number',
            placeholder: '0-100',
            immediate: true,
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
    });

    on: boolean = false;
    brightness: number = 100;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
    }

    async turnOn(): Promise<void> {
        this.on = true;
        await this.updateSupplementalLight();
    }

    async turnOff(): Promise<void> {
        this.on = false;
        await this.updateSupplementalLight();
    }

    async setBrightness(brightness: number): Promise<void> {
        this.brightness = brightness;
        await this.updateSupplementalLight();
    }

    private async updateSupplementalLight(): Promise<void> {
        const api = this.camera.getClient();
        const mode = this.storageSettings.values.mode;
        const brightness = this.storageSettings.values.brightness;
        await api.setSupplementLight({ on: this.on, brightness: brightness, mode });
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }
}
