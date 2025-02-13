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
            onPut: () => {
                this.setFloodlight(this.on, this.brightness)
                    .catch(err => this.console.error('Error updating mode', err));
            },
        },
        brightness: {
            title: 'Manual Brightness',
            description: 'Set brightness when in manual mode (0 to 100)',
            defaultValue: 0,
            type: 'number',
            placeholder: '0-100',
            onPut: () => {
                const brightness = parseInt(this.storage.getItem('brightness') || '0');
                this.brightness = brightness;
                if (this.on) {
                    this.setFloodlight(this.on, brightness)
                        .catch(err => this.console.error('Error updating brightness', err));
                }
            },
            onGet: async () => {
                const mode = this.storageSettings.values.mode;
                if (mode === 'manual') {
                    const stored = this.storage.getItem('manualBrightness');
                    return { value: stored && stored !== '' ? stored : '100', range: [0, 100] };
                }
                return { value: '', hide: true };
            }
        },
    });

    brightness: number;
    on: boolean;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
        this.brightness = 0;
    }

    async setBrightness(brightness: number): Promise<void> {
        this.brightness = brightness;
        const on = brightness > 0;
        await this.setFloodlight(on, brightness);
    }

    async turnOff(): Promise<void> {
        this.on = false;
        this.brightness = 0;
        await this.setFloodlight(false, 0);
    }

    async turnOn(): Promise<void> {
        this.on = true;
        if (this.brightness === 0) {
            this.brightness = 100;
        }
        await this.setFloodlight(true, this.brightness);
    }

    private async setFloodlight(on: boolean, brightness: number): Promise<void> {
        const api = this.camera.getClient();
        let mode: 'auto' | 'manual';
        const storedMode = this.storage.getItem('mode');
        if (storedMode === 'auto' || storedMode === 'manual') {
            mode = storedMode;
        } else {
            mode = on ? 'manual' : 'auto';
        }
        await api.setSupplementLight({ on, brightness, mode });
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }
}
