import { OnOff, Readme, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { HikvisionCamera } from "./main";

export class HikvisionAlarmSwitch extends ScryptedDeviceBase implements OnOff, Readme, Settings {
    on: boolean = false;
    private syncing = false;
    private capabilities = {
        supportsBeep: false,
        supportsWhiteLight: false,
        supportsIO: false,
    };
    private audioAlarmCapabilities: {
        supported: boolean;
        audioTypes: { id: number; description: string }[];
        volumeRange: { min: number; max: number };
        alarmTimesRange: { min: number; max: number };
    } | null = null;
    private whiteLightAlarmCapabilities: {
        supported: boolean;
        durationRange: { min: number; max: number };
        frequencyOptions: string[];
    } | null = null;

    storageSettings = new StorageSettings(this, {
        beepEnabled: {
            title: 'Enable Audible Alarm',
            description: 'Trigger the built-in siren/speaker when alarm is activated.',
            group: 'Linkages',
            type: 'boolean',
            defaultValue: true,
            immediate: true,
            hide: true,
            onPut: async () => {
                await this.updateLinkages();
            },
        },
        whiteLightEnabled: {
            title: 'Enable Strobe Light',
            description: 'Trigger the flashing white light when alarm is activated.',
            group: 'Linkages',
            type: 'boolean',
            immediate: true,
            defaultValue: true,
            hide: true,
            onPut: async () => {
                await this.updateLinkages();
            },
        },
        ioOutputEnabled: {
            title: 'Enable IO Output Relay',
            description: 'Activate the IO output relay when alarm is activated.',
            group: 'Linkages',
            type: 'boolean',
            defaultValue: false,
            immediate: true,
            hide: true,
            onPut: async () => {
                await this.updateLinkages();
            },
        },
        whiteLightDuration: {
            title: 'Duration (seconds)',
            description: 'How long the strobe light should flash when triggered.',
            group: 'Strobe Light',
            type: 'number',
            placeholder: '1-60',
            defaultValue: 15,
            range: [1, 60],
            hide: true,
            onPut: async () => {
                await this.updateWhiteLightAlarmSettings();
            },
        },
        whiteLightFrequency: {
            title: 'Flashing Frequency',
            description: 'Speed of the strobe light flashing.',
            group: 'Strobe Light',
            type: 'string',
            choices: ['high', 'medium', 'low', 'normallyOn'],
            defaultValue: 'medium',
            hide: true,
            onPut: async () => {
                await this.updateWhiteLightAlarmSettings();
            },
        },
        audioType: {
            title: 'Sound Type',
            description: 'Select the alarm sound to play.',
            group: 'Audio Alarm',
            type: 'string',
            choices: [],
            defaultValue: 'Siren',
            hide: true,
            onPut: async () => {
                await this.updateAudioAlarmSettings();
            },
        },
        alarmTimes: {
            title: 'Play Count',
            description: 'Number of times to repeat the alarm sound.',
            group: 'Audio Alarm',
            type: 'number',
            placeholder: '1-50',
            defaultValue: 5,
            range: [1, 50],
            hide: true,
            onPut: async () => {
                await this.updateAudioAlarmSettings();
            },
        },
        audioVolume: {
            title: 'Volume',
            description: 'Loudspeaker volume level.',
            group: 'Audio Alarm',
            type: 'number',
            placeholder: '1-100',
            defaultValue: 50,
            range: [1, 100],
            hide: true,
            onPut: async () => {
                await this.updateAudioAlarmSettings();
            },
        },
    });

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.syncFromCamera();
    }

    private async syncFromCamera(): Promise<void> {
        this.syncing = true;
        try {
            const api = this.camera.getClient();
            
            const { json } = await api.getAlarm('1');
            // triggering 'low' (NC mode) means alarm is ON, 'high' (NO mode) means alarm is OFF
            const isOn = json?.triggering?.[0] === 'low';
            this.on = isOn;

            try {
                this.capabilities = await api.getAlarmLinkageCapabilities();
                // this.console.log('Alarm linkage capabilities:', this.capabilities);
            } catch (e: any) {
                this.console.warn('Could not get linkage capabilities:', e);
            }

            try {
                this.audioAlarmCapabilities = await api.getAudioAlarmCapabilities();
                if (this.audioAlarmCapabilities) {
                    // this.console.log('Audio alarm capabilities:', this.audioAlarmCapabilities);
                    
                    const audioSettings = await api.getAudioAlarmSettings();
                    if (audioSettings) {
                        const audioType = this.audioAlarmCapabilities.audioTypes.find(t => t.id === audioSettings.audioID);
                        if (audioType) {
                            this.storageSettings.values.audioType = audioType.description;
                        }
                        this.storageSettings.values.audioVolume = audioSettings.audioVolume;
                        this.storageSettings.values.alarmTimes = audioSettings.alarmTimes;
                        // this.console.log('Synced audio alarm settings:', audioSettings);
                    }
                }
            } catch (e: any) {
                this.console.warn('Could not get audio alarm capabilities:', e);
            }

            try {
                this.whiteLightAlarmCapabilities = await api.getWhiteLightAlarmCapabilities();
                if (this.whiteLightAlarmCapabilities) {
                    // this.console.log('White light alarm capabilities:', this.whiteLightAlarmCapabilities);
                    
                    const lightSettings = await api.getWhiteLightAlarmSettings();
                    if (lightSettings) {
                        this.storageSettings.values.whiteLightDuration = lightSettings.durationTime;
                        this.storageSettings.values.whiteLightFrequency = lightSettings.frequency;
                        // this.console.log('Synced white light alarm settings:', lightSettings);
                    }
                }
            } catch (e: any) {
                this.console.warn('Could not get white light alarm capabilities:', e);
            }

            if (this.capabilities.supportsBeep || this.capabilities.supportsWhiteLight || this.capabilities.supportsIO) {
                try {
                    const linkages = await api.getAlarmLinkages();
                    if (this.capabilities.supportsBeep) {
                        this.storageSettings.values.beepEnabled = linkages.beep;
                    }
                    if (this.capabilities.supportsWhiteLight) {
                        this.storageSettings.values.whiteLightEnabled = linkages.whiteLight;
                    }
                    if (this.capabilities.supportsIO) {
                        this.storageSettings.values.ioOutputEnabled = linkages.io;
                    }
                    // this.console.log('Synced linkage settings:', linkages);
                } catch (e: any) {
                    this.console.warn('Could not sync linkage settings:', e);
                }
            }

            this.updateSettingsVisibility();
        } catch (e: any) {
            this.console.warn('Could not sync alarm state from camera:', e);
        } finally {
            this.syncing = false;
        }
    }

    private updateSettingsVisibility(): void {
        const hasAudioSupport = this.audioAlarmCapabilities?.supported ?? false;
        const hasWhiteLightSupport = this.whiteLightAlarmCapabilities?.supported ?? false;

        this.storageSettings.settings.beepEnabled.hide = !this.capabilities.supportsBeep;
        this.storageSettings.settings.whiteLightEnabled.hide = !this.capabilities.supportsWhiteLight;
        this.storageSettings.settings.ioOutputEnabled.hide = !this.capabilities.supportsIO;

        this.storageSettings.settings.whiteLightDuration.hide = !hasWhiteLightSupport;
        this.storageSettings.settings.whiteLightFrequency.hide = !hasWhiteLightSupport;

        if (hasWhiteLightSupport && this.whiteLightAlarmCapabilities) {
            this.storageSettings.settings.whiteLightDuration.range = [
                this.whiteLightAlarmCapabilities.durationRange.min,
                this.whiteLightAlarmCapabilities.durationRange.max,
            ];
            this.storageSettings.settings.whiteLightFrequency.choices = this.whiteLightAlarmCapabilities.frequencyOptions;
        }

        this.storageSettings.settings.audioType.hide = !hasAudioSupport;
        this.storageSettings.settings.alarmTimes.hide = !hasAudioSupport;
        this.storageSettings.settings.audioVolume.hide = !hasAudioSupport;

        if (hasAudioSupport && this.audioAlarmCapabilities) {
            this.storageSettings.settings.audioType.choices = this.audioAlarmCapabilities.audioTypes.map(t => t.description);
            this.storageSettings.settings.alarmTimes.range = [
                this.audioAlarmCapabilities.alarmTimesRange.min,
                this.audioAlarmCapabilities.alarmTimesRange.max,
            ];
            this.storageSettings.settings.audioVolume.range = [
                this.audioAlarmCapabilities.volumeRange.min,
                this.audioAlarmCapabilities.volumeRange.max,
            ];
        }
    }

    private async updateLinkages(): Promise<void> {
        if (this.syncing) return;
        
        try {
            const api = this.camera.getClient();
            await api.setAlarmLinkages({
                beep: this.capabilities.supportsBeep ? this.storageSettings.values.beepEnabled as boolean : false,
                whiteLight: this.capabilities.supportsWhiteLight ? this.storageSettings.values.whiteLightEnabled as boolean : false,
                io: this.capabilities.supportsIO ? this.storageSettings.values.ioOutputEnabled as boolean : false,
                whiteLightDuration: this.storageSettings.values.whiteLightDuration as number,
            });
        } catch (e: any) {
            this.console.error('Failed to update alarm linkage settings:', e);
        }
    }

    private async updateAudioAlarmSettings(): Promise<void> {
        if (this.syncing || !this.audioAlarmCapabilities) return;
        
        try {
            const api = this.camera.getClient();
            const audioTypeDesc = this.storageSettings.values.audioType as string;
            const audioType = this.audioAlarmCapabilities.audioTypes.find(t => t.description === audioTypeDesc);
            
            await api.setAudioAlarmSettings({
                audioID: audioType?.id || 1,
                audioVolume: this.storageSettings.values.audioVolume as number,
                alarmTimes: this.storageSettings.values.alarmTimes as number,
            });
        } catch (e: any) {
            this.console.error('Failed to update audio alarm settings:', e);
        }
    }

    private async updateWhiteLightAlarmSettings(): Promise<void> {
        if (this.syncing || !this.whiteLightAlarmCapabilities) return;
        
        try {
            const api = this.camera.getClient();
            await api.setWhiteLightAlarmSettings({
                durationTime: this.storageSettings.values.whiteLightDuration as number,
                frequency: this.storageSettings.values.whiteLightFrequency as string,
            });
        } catch (e: any) {
            this.console.error('Failed to update white light alarm settings:', e);
        }
    }

    async turnOn() {
        this.on = true;
        await this.setAlarm(true);
    }

    async turnOff() {
        this.on = false;
        await this.setAlarm(false);
    }
    
    private async setAlarm(state: boolean): Promise<void> {
        const api = this.camera.getClient();
        await api.setAlarm(state);
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }

    async getReadmeMarkdown(): Promise<string> {
        const hasLinkages = this.capabilities.supportsBeep || this.capabilities.supportsWhiteLight || this.capabilities.supportsIO;
        const hasAudioSettings = this.audioAlarmCapabilities?.supported;
        const hasWhiteLightSettings = this.whiteLightAlarmCapabilities?.supported;
        
        let linkageSection = '';
        if (hasLinkages) {
            linkageSection = `
### **Linkages Tab**
Configure which actions are triggered when the alarm is activated:
`;
            if (this.capabilities.supportsBeep) {
                linkageSection += `- **Audible Alarm** - Triggers the built-in siren/speaker\n`;
            }
            if (this.capabilities.supportsWhiteLight) {
                linkageSection += `- **Strobe Light** - Triggers the flashing white light\n`;
            }
            if (this.capabilities.supportsIO) {
                linkageSection += `- **IO Output Relay** - Activates the relay output\n`;
            }
        } else {
            linkageSection = `
### **Note**
This camera does not support configurable alarm linkages.`;
        }

        let strobeSection = '';
        if (hasWhiteLightSettings) {
            strobeSection = `
### **Strobe Light Tab**
Configure the strobe light behavior:
- **Duration** - How long the light flashes (1-${this.whiteLightAlarmCapabilities!.durationRange.max} seconds)
- **Frequency** - Flashing speed (high, medium, low, or always on)
`;
        }

        let audioSection = '';
        if (hasAudioSettings) {
            audioSection = `
### **Audio Alarm Tab**
Configure the audible alarm:
- **Sound Type** - Choose from ${this.audioAlarmCapabilities!.audioTypes.length} different alarm sounds
- **Play Count** - How many times to repeat the sound
- **Volume** - Loudspeaker volume level
`;
        }

        return `
## **Alarm Switch**
This switch triggers the camera's alarm input event, which activates configured linkage actions.

### **How It Works**
The alarm switch simulates an IO input alarm event by toggling the input triggering mode. This triggers all linkages configured for the Alarm Input event.
${linkageSection}${strobeSection}${audioSection}
### **Manual Configuration**
You can also configure alarm settings via the camera's web interface:

1. Log in to the camera's web interface.
2. Go to *Configuration > Event > Basic Event > Alarm Input*.
3. Select the alarm input (usually Input 1).
4. Under *Linkage Method*, enable the desired actions.
        `;
    }
}
