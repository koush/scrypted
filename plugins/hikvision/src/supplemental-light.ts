import { Brightness, OnOff, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { HikvisionCamera } from "./main";

export class HikvisionSupplementalLight extends ScryptedDeviceBase implements OnOff, Brightness, Settings {
    storageSettings = new StorageSettings(this, {
        supplementalLightMode: {
            title: 'Supplemental Light Mode',
            description: 'Available modes depend on your camera hardware.',
            type: 'radiopanel',
            choices: ['Smart', 'White', 'IR'],
            defaultValue: 'White',
            onPut: async () => {
                if (this.on) {
                    await this.updateSupplementalLight();
                }
            },
        },
        smartBrightnessControl: {
            title: 'Smart Brightness Control',
            type: 'string',
            choices: ['auto', 'manual'],
            defaultValue: 'auto',
            radioGroups: ['Smart'],
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        mode: {
            title: 'White Light Control',
            type: 'string',
            choices: ['auto', 'manual'],
            defaultValue: 'manual',
            radioGroups: ['White'],
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        brightness: {
            title: 'White Light Brightness',
            defaultValue: 100,
            type: 'number',
            placeholder: '0-100',
            range: [0, 100],
            radioGroups: ['White', 'Smart'],
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        irBrightnessControl: {
            title: 'IR Brightness Control',
            type: 'string',
            choices: ['auto', 'manual'],
            defaultValue: 'auto',
            radioGroups: ['IR'],
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        irManualBrightness: {
            title: 'IR Manual Brightness',
            type: 'number',
            placeholder: '0-100',
            range: [0, 100],
            defaultValue: 100,
            radioGroups: ['IR', 'Smart'],
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        smartSupplementLight: {
            title: 'Smart Supplement Light',
            description: 'Enable to automatically adjust exposure based on scene conditions.',
            type: 'boolean',
            defaultValue: false,
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
    });

    private syncing = false;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.syncFromCamera();
    }

    async syncFromCamera(): Promise<void> {
        this.syncing = true;
        try {
            const api = this.camera.getClient();
            const { on } = await api.getSupplementLightState();
            this.on = on;
            // this.console.log('Synced supplemental light state from camera:', { on });
        } catch (e) {
            this.console.warn('Could not sync supplemental light state:', e);
        } finally {
            this.syncing = false;
        }
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
    const supplementalLightMode = this.storageSettings.values.supplementalLightMode  as string;
        if (supplementalLightMode === 'IR') {
            this.storageSettings.values.irManualBrightness = brightness;
        } else {
            this.storageSettings.values.brightness = brightness;
        }
        await this.updateSupplementalLight();
    }

    private async updateSupplementalLight(): Promise<void> {
        if (this.syncing)
            return;

        const api = this.camera.getClient();
        const values = this.storageSettings.values;
        const supplementalLightMode = values.supplementalLightMode as string;

        let output: 'auto' | 'white' | 'ir' | undefined;
        let mode: 'auto' | 'manual' | undefined;
        let smartMode: 'auto' | 'manual' | undefined;
        let brightness: number | undefined;
        let whiteBrightness: number | undefined;
        let irBrightness: number | undefined;

        if (this.on) {
            if (supplementalLightMode === 'Smart') {
                output = 'auto';
                smartMode = values.smartBrightnessControl as 'auto' | 'manual';
                whiteBrightness = values.brightness as number;
                irBrightness = values.irManualBrightness as number;
            } else if (supplementalLightMode === 'IR') {
                output = 'ir';
                mode = values.irBrightnessControl as 'auto' | 'manual';
                irBrightness = values.irManualBrightness as number;
            } else {
                output = 'white';
                mode = values.mode as 'auto' | 'manual';
                whiteBrightness = values.brightness as number;
            }
        }

        await api.setSupplementLight({
            on: this.on,
            output,
            brightness,
            whiteBrightness,
            irBrightness,
            mode,
            smartMode,
            smartSupplementLightEnabled: values.smartSupplementLight as boolean,
        });
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }
}
