import { Brightness, OnOff, Readme, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { HikvisionCamera } from "./main";

export type LightMode = 'Smart' | 'White' | 'IR';

export type CameraLightType = 'smart-hybrid' | 'white-only' | 'ir-only' | 'not-supported';

export interface SupplementLightOptions {
    on?: boolean;
    output?: 'auto' | 'white' | 'ir';
    whiteBrightness?: number;
    irBrightness?: number;
    mode?: 'auto' | 'manual';
    smartMode?: 'auto' | 'manual';
    smartSupplementLightEnabled?: boolean;
}

interface ParsedCapabilities {
    modes: LightMode[];
    cameraType: CameraLightType;
}

export class HikvisionSupplementalLight extends ScryptedDeviceBase implements OnOff, Brightness, Settings, Readme {
    private availableModes: LightMode[] = [];
    private cameraType: CameraLightType = 'smart-hybrid';

    storageSettings = new StorageSettings(this, {
        smartSupplementLight: {
            title: 'Smart Supplement Light',
            description: 'Enable to automatically adjust exposure based on scene conditions.',
            type: 'boolean',
            defaultValue: false,
            hide: true,
            immediate: true,
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        supplementalLightMode: {
            title: 'Supplemental Light Mode',
            description: 'Available modes depend on your camera hardware.',
            type: 'radiopanel',
            choices: ['Smart', 'White', 'IR'],
            defaultValue: 'White',
            immediate: true,
            hide: true,
            onPut: async (oldValue, newValue) => {
                if (this.cameraType === 'white-only' && newValue !== 'White') {
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
            hide: true,
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        mode: {
            title: 'Light Brightness Control',
            type: 'string',
            choices: ['auto', 'manual'],
            defaultValue: 'manual',
            radioGroups: ['White'],
            hide: true,
            onPut: async () => {
                await this.updateSupplementalLight();
            },
        },
        brightness: {
            title: 'Light Manual Brightness',
            defaultValue: 100,
            type: 'number',
            placeholder: '0-100',
            range: [0, 100],
            radioGroups: ['White', 'Smart'],
            hide: true,
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
            hide: true,
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
            hide: true,
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
                const { modes, cameraType } = this.parseCapabilities(capsJson);
                
                this.availableModes = modes;
                this.cameraType = cameraType;
                
                if (cameraType === 'white-only') {
                    this.storageSettings.values.supplementalLightMode = 'White';
                } else if (cameraType === 'ir-only') {
                    this.storageSettings.values.supplementalLightMode = 'IR';
                }
            } catch (e: any) {
                if (this.handleNotSupportedError(e)) return;
                this.console.warn('Could not fetch supplemental light capabilities:', e);
            }
            
            const { on } = await api.getSupplementLightState();
            this.on = on;

            this.updateSettingsVisibility();
        } catch (e: any) {
            if (this.handleNotSupportedError(e)) return;
            this.console.warn('Could not sync supplemental light state:', e);
        } finally {
            this.syncing = false;
        }
    }

    private parseCapabilities(capsJson: { SupplementLight?: Record<string, any> }): ParsedCapabilities {
        const caps = capsJson?.SupplementLight;
        const optString: string = caps?.supplementLightMode?.opt || '';
        const opts = optString.split(',').map((s: string) => s.trim()).filter(Boolean);
        
        const modes: LightMode[] = [];
        if (opts.includes('eventIntelligence')) modes.push('Smart');
        if (opts.includes('colorVuWhiteLight')) modes.push('White');
        if (opts.includes('irLight')) modes.push('IR');
        
        const cameraType: CameraLightType = 
            modes.length === 0 ? 'not-supported' :
            modes.length === 1 && modes[0] === 'White' ? 'white-only' :
            modes.length === 1 && modes[0] === 'IR' ? 'ir-only' :
            'smart-hybrid';
        
        return { modes, cameraType };
    }

    private handleNotSupportedError(e: any): boolean {
        if (e?.statusCode === 403 || e?.message?.includes('403')) {
            this.console.error('This camera may not support supplemental lights. Please remove the supplemental light device from this camera.');
            this.cameraType = 'not-supported';
            this.availableModes = [];
            this.updateSettingsVisibility();
            return true;
        }
        return false;
    }

    private updateSettingsVisibility(): void {
        const hasSmart = this.availableModes.includes('Smart');
        const hasWhite = this.availableModes.includes('White');
        const hasIr = this.availableModes.includes('IR');
        const isSingleMode = this.cameraType === 'white-only' || this.cameraType === 'ir-only';

        this.storageSettings.settings.supplementalLightMode.hide = isSingleMode;
        this.storageSettings.settings.supplementalLightMode.choices = this.availableModes;

        this.storageSettings.settings.smartBrightnessControl.hide = !hasSmart;

        this.storageSettings.settings.mode.hide = !hasWhite;
        this.storageSettings.settings.brightness.hide = !hasWhite && !hasSmart;

        this.storageSettings.settings.irBrightnessControl.hide = !hasIr;
        this.storageSettings.settings.irManualBrightness.hide = !hasIr && !hasSmart;

        this.storageSettings.settings.smartSupplementLight.hide = this.cameraType === 'not-supported';
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
        if (this.storageSettings.values.supplementalLightMode === 'IR') {
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
        const { supplementalLightMode, smartSupplementLight, smartBrightnessControl, brightness, irBrightnessControl, irManualBrightness, mode } = this.storageSettings.values;

        const options: SupplementLightOptions = {
            on: this.on,
            smartSupplementLightEnabled: smartSupplementLight,
        };

        if (this.on) {
            switch (supplementalLightMode) {
                case 'Smart':
                    options.output = 'auto';
                    options.smartMode = smartBrightnessControl;
                    options.whiteBrightness = brightness;
                    options.irBrightness = irManualBrightness;
                    break;
                case 'IR':
                    options.output = 'ir';
                    options.mode = irBrightnessControl;
                    options.irBrightness = irManualBrightness;
                    break;
                case 'White':
                default:
                    options.output = 'white';
                    options.mode = mode;
                    options.whiteBrightness = brightness;
                    break;
            }
        }

        await api.setSupplementLight(options);
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }

    async getReadmeMarkdown(): Promise<string> {
        if (this.cameraType === 'not-supported') {
            return `
## **Supplemental Light**

### **Not Supported**
This camera does not support supplemental light control. Please remove this device from the camera.
            `;
        }

        const hasSmart = this.availableModes.includes('Smart');
        const hasWhite = this.availableModes.includes('White');
        const hasIr = this.availableModes.includes('IR');
        const hasAnyModes = this.availableModes.length > 0;

        let modesSection = '';
        if (hasAnyModes) {
            modesSection = `
### **Supported Modes**
`;
            if (hasSmart) {
                modesSection += `- **Smart Mode** - IR light at night, switches to white light when motion is detected.\n`;
            }
            if (hasWhite) {
                modesSection += `- **White Light Mode** - Full color night vision using white LEDs.\n`;
            }
            if (hasIr) {
                modesSection += `- **IR Light Mode** - Traditional infrared night vision.\n`;
            }
        } else {
            modesSection = `
### **Note**
This camera does not support configurable supplemental light modes.`;
        }

        let settingsSection = '';
        if (hasAnyModes) {
            settingsSection = `
### **Settings**
`;
            if (this.availableModes.length > 1) {
                settingsSection += `- **Supplemental Light Mode** - Choose between available modes\n`;
            }
            settingsSection += `- **Brightness Control** - Select automatic or manual brightness\n`;
            settingsSection += `- **Manual Brightness** - Adjust light level (0-100)\n`;
            settingsSection += `- **Smart Supplement Light** - Enable automatic exposure adjustment\n`;
        }

        let smartNotes = '';
        if (hasSmart) {
            smartNotes = `
### **Smart Mode Notes**
In normal conditions at night, IR light is on and the image is black and white. When a person or vehicle is detected, white light turns on as a warning and the image becomes full color.

- Requires motion detection to be enabled on the camera.
- Keep this device switched **on** to enable automatic lighting.
`;
        }

        let brightnessNotes = `
**Smart Supplement Light** prevents overexposure when the light is on. Enable if the image appears washed out with the light active.
`;

        return `
## **Supplemental Light**
Controls the camera's supplemental lighting for night vision and low-light scenarios.
${modesSection}${settingsSection}${smartNotes}${brightnessNotes}
        `;
    }
}
