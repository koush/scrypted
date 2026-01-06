import { Brightness, OnOff, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { HikvisionCamera } from "./main";

export class HikvisionSupplementalLight extends ScryptedDeviceBase implements OnOff, Brightness, Settings {
    storageSettings = new StorageSettings(this, {
        supplementalLightMode: {
            title: 'Supplemental Light Mode',
            description: 'Available modes depend on your camera hardware.',
            type: 'radiopanel',
            choices: ['Smart', 'White', 'IR', 'Off'],
            defaultValue: 'White',
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
        try {
            const api = this.camera.getClient();
            const values = this.storageSettings.values;
            const supplementalLightMode = values.supplementalLightMode as string;
            const smartSupplementLight = values.smartSupplementLight as boolean;

            let on = this.on;
            let output: 'auto' | 'white' | 'ir' | undefined;
            let mode: 'auto' | 'manual' | undefined;
            let brightness: number | undefined;

            if (supplementalLightMode === 'Off') {
                on = false;
            } else if (on) {
                if (supplementalLightMode === 'Smart') {
                    output = 'auto';
                } else if (supplementalLightMode === 'White') {
                    output = 'white';
                    mode = values.mode as 'auto' | 'manual';
                    if (mode === 'manual') {
                        brightness = values.brightness as number;
                    }
                } else if (supplementalLightMode === 'IR') {
                    output = 'ir';
                    mode = values.irBrightnessControl as 'auto' | 'manual';
                    if (mode === 'manual') {
                        brightness = values.irManualBrightness as number;
                    }
                } else {
                    throw new Error('Unknown supplemental light mode: ' + supplementalLightMode);
                }
            }

            await api.setSupplementLight({
                on,
                output,
                brightness,
                mode,
                smartSupplementLightEnabled: smartSupplementLight,
            });
        } catch (e) {
            this.console.error('Failed to update supplemental light:', e);
            throw e; 
        }
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }
}
