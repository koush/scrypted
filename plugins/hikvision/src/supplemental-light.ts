import { Brightness, OnOff, Readme, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { HikvisionCamera } from "./main";

export class HikvisionSupplementalLight extends ScryptedDeviceBase implements OnOff, Brightness, Settings, Readme {
    private availableModes: string[] = ['Smart', 'White', 'IR'];
    private whiteOnlyCamera: boolean = false;
    private irOnlyCamera: boolean = false;

    storageSettings = new StorageSettings(this, {
        supplementalLightMode: {
            title: 'Supplemental Light Mode',
            description: 'Available modes depend on your camera hardware.',
            type: 'radiopanel',
            choices: ['Smart', 'White', 'IR'],
            defaultValue: 'White',
            onPut: async (oldValue, newValue) => {
                if (this.whiteOnlyCamera && newValue !== 'White') {
                    this.storageSettings.values.supplementalLightMode = 'White';
                    this.console.warn('This camera only supports white light mode.');
                    return;
                }
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
            
            try {
                const { json: capsJson } = await api.getSupplementLightCapabilities();
                const caps: any = capsJson.SupplementLight;
                const optString = caps?.supplementLightMode?.opt || '';
                const opts = optString.split(',').map((s: string) => s.trim()).filter(Boolean);
                
                const hasIr = opts.includes('irLight');
                const hasSmart = opts.includes('eventIntelligence');
                const hasWhite = opts.includes('colorVuWhiteLight');
                
                const modes: string[] = [];
                if (hasSmart) modes.push('Smart');
                if (hasWhite) modes.push('White');
                if (hasIr) modes.push('IR');
                
                if (modes.length === 1) {
                    if (modes[0] === 'White') {
                        this.whiteOnlyCamera = true;
                        this.irOnlyCamera = false;
                        this.availableModes = ['White'];
                        this.storageSettings.values.supplementalLightMode = 'White';
                    } else if (modes[0] === 'IR') {
                        this.irOnlyCamera = true;
                        this.whiteOnlyCamera = false;
                        this.availableModes = ['IR'];
                        this.storageSettings.values.supplementalLightMode = 'IR';
                    }
                } else if (modes.length > 0) {
                    this.availableModes = modes;
                    this.whiteOnlyCamera = false;
                    this.irOnlyCamera = false;
                }
            } catch (e: any) {
                if (e?.statusCode === 403 || e?.message?.includes('403')) {
                    this.console.error('This camera may not support supplemental lights. Please remove the supplemental light device from this camera.');
                    return;
                }
                this.console.warn('Could not fetch supplemental light capabilities:', e);
            }
            
            const { on } = await api.getSupplementLightState();
            this.on = on;
            // this.console.log('Synced supplemental light state from camera:', { on });
        } catch (e: any) {
            if (e?.statusCode === 403 || e?.message?.includes('403')) {
                this.console.error('This camera may not support supplemental lights. Please remove the supplemental light device from this camera.');
                return;
            }
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
            whiteBrightness,
            irBrightness,
            mode,
            smartMode,
            smartSupplementLightEnabled: values.smartSupplementLight as boolean,
        });
    }

    async getSettings(): Promise<Setting[]> {
        const settings = await this.storageSettings.getSettings();
        
        const filteredSettings = settings.filter(s => {
            if ((this.whiteOnlyCamera || this.irOnlyCamera) && s.key === 'supplementalLightMode') {
                return false;
            }
            
            if (s.key === 'supplementalLightMode') {
                s.choices = this.availableModes;
            }
            
            const radioGroups = (s as any).radioGroups as string[] | undefined;
            if (!radioGroups || radioGroups.length === 0) {
                return true;
            }
            return radioGroups.some(group => this.availableModes.includes(group));
        });
        
        return filteredSettings;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }

    async getReadmeMarkdown(): Promise<string> {
        return `
## **Supplemental Light**
This device controls the camera's supplemental lighting.

### **Light Modes**

Your camera's supported modes are automatically detected. If only one mode is supported, the mode selection will be hidden.

- **IR Light Mode**
- **White Light Mode**
- **Smart Mode**: Automatically switches between IR and white light based on motion events. When motion is detected in the camera's detection zones, the white light automatically turns on. Otherwise, IR light is used.

### **Settings**
- **Supplemental Light Mode**: Choose between Smart, White, or IR modes. If your camera only supports one mode, this option will be hidden.
- **Brightness Control**: Select automatic or manual brightness control for the selected light mode.
- **Manual Brightness**: Adjust brightness for white and/or IR light (0-100).
- **Smart Supplement Light**: Enable to automatically adjust exposure based on scene conditions.

**Smart Mode Notes**: 
- Smart Mode requires motion detection to be set up and enabled on the camera.
- When using Smart Mode, keep this supplemental light device switched **on** to enable automatic lighting control based on motion events.
        `;
    }
}
