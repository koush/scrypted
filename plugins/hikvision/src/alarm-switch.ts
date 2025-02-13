import { OnOff, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { HikvisionCamera } from "./main";


export class HikvisionAlarmSwitch extends ScryptedDeviceBase implements OnOff, Settings {
    storageSettings = new StorageSettings(this, {
        alarmTriggerItems: {
            title: 'Alarm Trigger Items',
            description: 'Select the action types to activate with the alarm.',
            defaultValue: ['audioAlarm', 'whiteLight'],
            multiple: true,
            choices: [
                'audioAlarm',
                'whiteLight'
            ],
        },
        audioAlarmType: {
            title: 'Audio Alarm Type',
            description: 'Select the audio alarm sound clip.',
            type: 'string',
            choices: [],
            defaultValue: '1',
        },
        audioAlarmVolume: {
            title: 'Audio Alarm Volume',
            description: 'Set the audio alarm volume.',
            type: 'number',
            defaultValue: 100,
        },
        alarmTimes: {
            title: 'Alarm Times',
            description: 'Number of repetitions for the audio alarm.',
            type: 'number',
            defaultValue: 5,
        },
        // audioClass: {
        //     title: 'Audio Alarm Class',
        //     description: 'Select the audio alarm class if supported.',
        //     type: 'string',
        //     choices: ['alertAudio', 'promptAudio', 'customAudio'],
        //     defaultValue: 'alertAudio',
        // },
        // customAudioID: {
        //     title: 'Custom Audio ID',
        //     description: 'If custom audio is used, select its ID.',
        //     type: 'number',
        //     // defaultValue: 1,
        // },
        whiteLightDuration: {
            title: 'White Light Duration (s)',
            description: 'Duration (in seconds) for which the white light is enabled (1–60).',
            type: 'number',
            defaultValue: 15,
        },
        whiteLightFrequency: {
            title: 'White Light Frequency',
            description: 'Flashing frequency (e.g., high, medium, low, normallyOn).',
            type: 'string',
            choices: [],
            defaultValue: 'normallyOn',
        },
    });

    on: boolean;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
    }

    async getSettings(): Promise<Setting[]> {
        let settings = await this.storageSettings.getSettings();

        try {
            const { json } = await this.camera.getClient().getAudioAlarmCapabilities();
            if (json && json.AudioAlarmCap && json.AudioAlarmCap.audioTypeListCap) {
                const choices = json.AudioAlarmCap.audioTypeListCap.map((item: any) => ({
                    title: item.audioDescription,
                    value: item.audioID.toString()
                }));
                const audioAlarmTypeSetting = settings.find(s => s.key === 'audioAlarmType');
                if (audioAlarmTypeSetting) {
                    audioAlarmTypeSetting.choices = choices;
                    if (!audioAlarmTypeSetting.value && choices.length > 0) {
                        audioAlarmTypeSetting.value = choices[0].value;
                    }
                }

                const volCap = json.AudioAlarmCap.audioVolume;
                const timesCap = json.AudioAlarmCap.alarmTimes;
                const audioAlarmVolumeSetting = settings.find(s => s.key === 'audioAlarmVolume');
                if (audioAlarmVolumeSetting && volCap) {
                    audioAlarmVolumeSetting.range = [Number(volCap["@min"]), Number(volCap["@max"])];
                    if (!audioAlarmVolumeSetting.value) {
                        audioAlarmVolumeSetting.value = volCap["@def"];
                    }
                }

                const alarmTimesSetting = settings.find(s => s.key === 'alarmTimes');
                if (alarmTimesSetting && timesCap) {
                    alarmTimesSetting.range = [Number(timesCap["@min"]), Number(timesCap["@max"])];
                    if (!alarmTimesSetting.value) {
                        alarmTimesSetting.value = timesCap["@def"];
                    }
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching audio alarm capabilities:', e);
        }

        try {
            const { json: currentConfig } = await this.camera.getClient().getAudioAlarm();
            if (currentConfig && currentConfig.AudioAlarm) {
                const currentAudioID = currentConfig.AudioAlarm.audioID;
                const audioAlarmTypeSetting = settings.find(s => s.key === 'audioAlarmType');
                if (audioAlarmTypeSetting) {
                    audioAlarmTypeSetting.value = currentAudioID.toString();
                }
                const currentAudioVolume = currentConfig.AudioAlarm.audioVolume;
                const audioAlarmVolumeSetting = settings.find(s => s.key === 'audioAlarmVolume');
                if (audioAlarmVolumeSetting && currentAudioVolume !== undefined) {
                    audioAlarmVolumeSetting.value = currentAudioVolume.toString();
                }
                const currentAlarmTimes = currentConfig.AudioAlarm.alarmTimes;
                const alarmTimesSetting = settings.find(s => s.key === 'alarmTimes');
                if (alarmTimesSetting && currentAlarmTimes !== undefined) {
                    alarmTimesSetting.value = currentAlarmTimes.toString();
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching current audio alarm configuration:', e);
        }

        try {
            const { json } = await this.camera.getClient().getWhiteLightAlarmCapabilities();
            if (json && json.WhiteLightAlarmCap) {
                const durationCap = json.WhiteLightAlarmCap.durationTime;
                const whiteLightDurationSetting = settings.find(s => s.key === 'whiteLightDuration');
                if (whiteLightDurationSetting && durationCap) {
                    whiteLightDurationSetting.range = [Number(durationCap["@min"]), Number(durationCap["@max"])];
                    if (!whiteLightDurationSetting.value) {
                        whiteLightDurationSetting.value = durationCap["@def"];
                    }
                }
                const frequencyCap = json.WhiteLightAlarmCap.frequency;
                const whiteLightFrequencySetting = settings.find(s => s.key === 'whiteLightFrequency');
                if (whiteLightFrequencySetting && frequencyCap) {
                    whiteLightFrequencySetting.choices = frequencyCap["@opt"].split(',');
                    if (!whiteLightFrequencySetting.value) {
                        whiteLightFrequencySetting.value = frequencyCap["@def"];
                    }
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching white light alarm capabilities:', e);
        }

        try {
            const { json: currentWhiteLightConfig } = await this.camera.getClient().getWhiteLightAlarm();
            if (currentWhiteLightConfig && currentWhiteLightConfig.WhiteLightAlarm) {
                const whiteLightAlarm = currentWhiteLightConfig.WhiteLightAlarm;

                const whiteLightDurationSetting = settings.find(s => s.key === 'whiteLightDuration');
                if (whiteLightDurationSetting && whiteLightAlarm.durationTime !== undefined) {
                    whiteLightDurationSetting.value = whiteLightAlarm.durationTime.toString();
                }

                const whiteLightFrequencySetting = settings.find(s => s.key === 'whiteLightFrequency');
                if (whiteLightFrequencySetting && whiteLightAlarm.frequency) {
                    whiteLightFrequencySetting.value = whiteLightAlarm.frequency;
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching current white light alarm configuration:', e);
        }
        return settings;
    }
    
    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);

        const selectedItems: string[] = this.storageSettings.values.alarmTriggerItems || [];
        try {
            const { audioAlarmType, audioAlarmVolume, alarmTimes } = this.storageSettings.values;
            await this.camera.getClient().setAudioAlarm(
                audioAlarmType,
                audioAlarmVolume.toString(),
                alarmTimes.toString()
            );
        
            const { whiteLightDuration, whiteLightFrequency } = this.storageSettings.values;
            await this.camera.getClient().setWhiteLightAlarm({
                durationTime: Number(whiteLightDuration),
                frequency: whiteLightFrequency
            });
        
            await this.camera.getClient().setAlarmTriggerConfig(selectedItems);
        } catch (e) {
            this.console.error('[AlarmSwitch] Error updating alarm configuration:', e);
        }
    }

    async turnOn(): Promise<void> {
        this.on = true;
        try {
            await this.camera.getClient().setAlarm(true);
        } catch (e) {
            this.console.error('[AlarmSwitch] Error triggering alarm input:', e);
            throw e;
        }
    }

    async turnOff(): Promise<void> {
        this.on = false;
        try {
            await this.camera.getClient().setAlarm(false);
        } catch (e) {
            this.console.error('[AlarmSwitch] Error resetting alarm input:', e);
        }
    }
}
