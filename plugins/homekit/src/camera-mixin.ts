import { MixinDeviceBase, VideoCamera, Settings, Setting, ScryptedInterface } from "@scrypted/sdk";

export class CameraMixin extends MixinDeviceBase<VideoCamera & Settings> implements Settings {
    constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
        super(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, providerNativeId);
    }

    async getSettings(): Promise<Setting[]> {
        const settings = this.mixinDeviceInterfaces.includes(ScryptedInterface.Settings) ?
            await this.mixinDevice.getSettings() : [];
        settings.push({
            group: 'HomeKit Settings',
            title: 'Transcode Streaming',
            type: 'boolean',
            key: 'transcodeStreaming',
            value: (this.storage.getItem('transcodeStreaming') === 'true').toString(),
            description: 'Use FFMpeg to transcode streaming to a format supported by HomeKit.',
        });

        if (this.interfaces.includes(ScryptedInterface.MotionSensor)) {
            settings.push({
                group: 'HomeKit Settings',
                title: 'Transcode Recording',
                key: 'transcodeRecording',
                type: 'boolean',
                value: (this.storage.getItem('transcodeRecording') === 'true').toString(),
                description: 'Use FFMpeg to transcode recording to a format supported by HomeKit Secure Video.',
            });
        }

        return settings;
    }
    async putSetting(key: string, value: string | number | boolean) {
        this.storage.setItem(key, value.toString());
    }
}
