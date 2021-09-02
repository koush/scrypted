import sdk, { VideoCamera, Settings, Setting, ScryptedInterface } from "@scrypted/sdk";
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";

const { log } = sdk;

export class CameraMixin extends SettingsMixinDeviceBase<VideoCamera & Settings> implements Settings {
    constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
        super(mixinDevice, mixinDeviceState, {
            providerNativeId,
            mixinDeviceInterfaces,
            group: "HomeKit Settings",
            groupKey: "homekit",
        });
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings: Setting[] = [];

        settings.push({
            title: 'Transcode Streaming',
            type: 'boolean',
            key: 'transcodeStreaming',
            value: (this.storage.getItem('transcodeStreaming') === 'true').toString(),
            description: 'Use FFMpeg to transcode streaming to a format supported by HomeKit.',
        });

        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.MotionSensor)) {
            settings.push({
                title: 'Transcode Recording',
                key: 'transcodeRecording',
                type: 'boolean',
                value: (this.storage.getItem('transcodeRecording') === 'true').toString(),
                description: 'Use FFMpeg to transcode recording to a format supported by HomeKit Secure Video.',
            });
        }

        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.AudioSensor)) {
            settings.push({
                title: 'Audio Activity Detection',
                key: 'detectAudio',
                type: 'boolean',
                value: (this.storage.getItem('detectAudio') === 'true').toString(),
                description: 'Send audio activity to HomeKit as motion events to trigger camera notifications and recordings.',
            });
        }

        return settings;
    }

    async putMixinSetting(key: string, value: string | number | boolean) {
        this.storage.setItem(key, value.toString());
        if (key === 'detectAudio') {
            log.a('You must reload the HomeKit plugin for this change to take effect.');
        }
    }
}
