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

        let showTranscodeArgs = this.storage.getItem('transcodeStreaming') === 'true';

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

            showTranscodeArgs = showTranscodeArgs || this.storage.getItem('transcodeRecording') === 'true';
        }

        if (showTranscodeArgs) {
            settings.push({
                title: 'Video Decoder Arguments',
                key: "videoDecoderArguments",
                value: this.storage.getItem('videoDecoderArguments'),
                description: 'FFmpeg arguments used to decode input video.',
                placeholder: '-hwaccel auto',
            });
            settings.push({
                title: 'H264 Encoder Arguments',
                key: "h264EncoderArguments",
                value: this.storage.getItem('h264EncoderArguments'),
                description: 'FFmpeg arguments used to encode h264 video.',
                placeholder: '-vcodec h264_omx',
            });
        }

        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.AudioSensor)) {
            settings.push({
                title: 'Audio Activity Detection',
                key: 'detectAudio',
                type: 'boolean',
                value: (this.storage.getItem('detectAudio') === 'true').toString(),
                description: 'Trigger HomeKit Secure Video recording on audio activity.',
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
