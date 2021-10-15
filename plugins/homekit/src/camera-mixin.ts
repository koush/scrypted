import sdk, { VideoCamera, Settings, Setting, ScryptedInterface, ObjectDetector, SettingValue, MediaStreamOptions } from "@scrypted/sdk";
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { getH264DecoderArgs, getH264EncoderArgs } from "../../../common/src/ffmpeg-hardware-acceleration";

const { log, systemManager, deviceManager } = sdk;

export class CameraMixin extends SettingsMixinDeviceBase<any> implements Settings {
    constructor(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
        super(mixinDevice, mixinDeviceState, {
            providerNativeId,
            mixinDeviceInterfaces,
            group: "HomeKit Settings",
            groupKey: "homekit",
        });
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings: Setting[] = [];
        const realDevice = systemManager.getDeviceById<ObjectDetector & VideoCamera>(this.id);

        let msos: MediaStreamOptions[] = [];
        try {
            msos = await realDevice.getVideoStreamOptions();
        }
        catch (e) {
        }

        if (msos?.length) {
            settings.push({
                title: 'Live Stream',
                key: 'streamingChannel',
                value: this.storage.getItem('streamingChannel') || msos[0].name,
                description: 'The media stream to use when streaming to HomeKit.',
                choices: msos.map(mso => mso.name),
            });

            settings.push({
                title: 'Live Stream (Hub)',
                key: 'streamingChannelHub',
                value: this.storage.getItem('streamingChannelHub') || msos[0].name,
                description: 'The media stream to use when streaming to a HomeKit Hub (remote viewing).',
                choices: msos.map(mso => mso.name),
            });
        }
        if (this.interfaces.includes(ScryptedInterface.MotionSensor)) {
            if (msos?.length) {
                settings.push({
                    title: 'Recording Stream',
                    key: 'recordingChannel',
                    value: this.storage.getItem('recordingChannel') || msos[0].name,
                    description: 'The prebuffered media stream for HomeKit Secure Video.',
                    choices: msos.map(mso => mso.name),
                });
            }
        }

        settings.push({
            title: 'Transcode Streaming',
            type: 'boolean',
            key: 'transcodeStreaming',
            value: (this.storage.getItem('transcodeStreaming') === 'true').toString(),
            description: 'Use FFMpeg to transcode streaming to a format supported by HomeKit.',
        });
        settings.push({
            title: 'Transcode Streaming (Hub)',
            type: 'boolean',
            key: 'transcodeStreamingHub',
            value: (this.storage.getItem('transcodeStreamingHub') === 'true').toString(),
            description: 'Use FFMpeg to transcode streaming to a format supported by HomeKit.',
        });
        let showTranscodeArgs = this.storage.getItem('transcodeStreaming') === 'true'
            || this.storage.getItem('transcodeStreamingHub') === 'true';

        if (this.interfaces.includes(ScryptedInterface.MotionSensor)) {
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
            const encoderArgs = getH264EncoderArgs();
            const decoderArgs = getH264DecoderArgs();

            settings.push({
                title: 'Video Decoder Arguments',
                key: "videoDecoderArguments",
                value: this.storage.getItem('videoDecoderArguments'),
                description: 'FFmpeg arguments used to decode input video.',
                placeholder: '-hwaccel auto',
                choices: Object.keys(decoderArgs),
                combobox: true,
            });
            settings.push({
                title: 'H264 Encoder Arguments',
                key: "h264EncoderArguments",
                value: this.storage.getItem('h264EncoderArguments'),
                description: 'FFmpeg arguments used to encode h264 video.',
                placeholder: '-vcodec h264_omx',
                choices: Object.keys(encoderArgs),
                combobox: true,
            });
        }

        settings.push({
            title: 'Linked Motion Sensor',
            key: 'linkedMotionSensor',
            type: 'device',
            deviceFilter: 'interfaces.includes("MotionSensor")',
            value: this.storage.getItem('linkedMotionSensor') || null,
            placeholder: this.providedInterfaces.includes(ScryptedInterface.MotionSensor)
                ? 'Built-In Motion Sensor' : 'None',
            description: "Link motion sensor used to trigger HomeKit Secure Video recordings.",
        })

        if (this.interfaces.includes(ScryptedInterface.AudioSensor)) {
            settings.push({
                title: 'Audio Activity Detection',
                key: 'detectAudio',
                type: 'boolean',
                value: (this.storage.getItem('detectAudio') === 'true').toString(),
                description: 'Trigger HomeKit Secure Video recording on audio activity.',
            });
        }

        if (this.interfaces.includes(ScryptedInterface.ObjectDetector)) {
            try {
                const types = await realDevice.getObjectTypes();
                const choices = types.people.map(p => p.label) || [];
                if (types.detections)
                    choices.push(...types.detections);

                const value: string[] = [];
                try {
                    value.push(...JSON.parse(this.storage.getItem('objectDetectionContactSensors')));
                }
                catch (e) {
                }

                settings.push({
                    title: 'Object Detection Contact Sensors',
                    type: 'string',
                    choices,
                    multiple: true,
                    key: 'objectDetectionContactSensors',
                    description: 'Create HomeKit contact sensors that detect specific people or objects.',
                    value,
                })
            }
            catch (e) {
            }
        }

        return settings;
    }

    async putMixinSetting(key: string, value: SettingValue) {
        if (key === 'videoDecoderArguments') {
            const decoderArgs = getH264DecoderArgs();
            value = decoderArgs[value.toString()]?.join(' ') || value;
        }

        if (key === 'h264EncoderArguments') {
            const encoderArgs = getH264EncoderArgs();
            const substitute = encoderArgs[value.toString()]?.join(' ');
            value = substitute ? `\`${substitute}\`` : value;
        }

        if (key === 'objectDetectionContactSensors') {
            this.storage.setItem(key, JSON.stringify(value));
        }
        else {
            this.storage.setItem(key, value?.toString());
        }

        if (key === 'detectAudio' || key === 'linkedMotionSensor' || key === 'objectDetectionContactSensors') {
            log.a(`You must reload the HomeKit plugin for the changes to ${this.name} to take effect.`);
        }

        deviceManager.onMixinEvent(this.id, this.mixinProviderNativeId, ScryptedInterface.Settings, undefined);
    }
}
