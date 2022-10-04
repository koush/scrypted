import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import sdk, { ObjectDetector, Readme, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, VideoCamera } from "@scrypted/sdk";
import { HomekitMixin } from "./homekit-mixin";

const { systemManager, deviceManager, log } = sdk;

export const defaultObjectDetectionContactSensorTimeout = 60;

export function canCameraMixin(type: ScryptedDeviceType, interfaces: string[]) {
    return (type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell)
        && interfaces.includes(ScryptedInterface.VideoCamera);
}

export class CameraMixin extends HomekitMixin<Readme & VideoCamera> implements Readme {
    cameraStorageSettings = new StorageSettings(this, {
        hasWarnedBridgedCamera: {
            description: 'Setting to warn user that bridged cameras are bad.',
            type: 'boolean',
            hide: true,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<Readme & VideoCamera>) {
        super(options);

        if (!this.cameraStorageSettings.values.hasWarnedBridgedCamera) {
            this.cameraStorageSettings.values.hasWarnedBridgedCamera = true;
            log.a(`${this.name} is paired in Bridge Mode. Using Standalone Accessory Mode is recommended for cameras for optimal performance.`)
        }
    }

    async getReadmeMarkdown(): Promise<string> {
        let readme = this.mixinDeviceInterfaces.includes(ScryptedInterface.Readme) ? await this.mixinDevice.getReadmeMarkdown() + '\n\n' : '';

        if (!this.storageSettings.values.standalone) {
            readme += `
## <span style="color:red">HomeKit Performance Warning</span>

HomeKit Cameras should be paired to HomeKit in Accessory Mode for optimal performance. iOS 15.5+ will always route bridged camera video through the active HomeHub, which may result in severe performance degradation.

Enable Standalone Accessory Mode in the HomeKit settings for this camera and reload the HomeKit plugin. This camera can then be individually paired with the Home app. The pairing QR code can be seen in this camera\'s console.

More details can be found [here](https://github.com/koush/scrypted/blob/main/plugins/homekit/notes/iOS-15.5.md).
`;
        }

        const id = deviceManager.getDeviceState(this.mixinProviderNativeId).id;
        readme += `
## HomeKit Codec Settings

The recommended codec settings for cameras in HomeKit can be viewed in the [HomeKit plugin](#/device/${id}).`

        return readme;
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings: Setting[] = [];
        const realDevice = systemManager.getDeviceById<ObjectDetector & VideoCamera>(this.id);

        settings.push(
            {
                title: 'Linked Motion Sensor',
                key: 'linkedMotionSensor',
                type: 'device',
                deviceFilter: 'interfaces.includes("MotionSensor")',
                value: this.storage.getItem('linkedMotionSensor') || this.id,
                placeholder: this.interfaces.includes(ScryptedInterface.MotionSensor)
                    ? undefined : 'None',
                description: "Set the motion sensor used to trigger HomeKit Secure Video recordings. Defaults to the device provided motion sensor when available.",
            },
        );

        // settings.push({
        //     title: 'H265 Streams',
        //     key: 'h265Support',
        //     description: 'Camera outputs h265 codec streams.',
        //     value: (this.storage.getItem('h265Support') === 'true').toString(),
        //     type: 'boolean',
        // });

        if (this.interfaces.includes(ScryptedInterface.VideoCameraConfiguration)) {
            let adaptiveBitrate: string[] = [];
            try {
                adaptiveBitrate = JSON.parse(this.storage.getItem('adaptiveBitrate'));
            }
            catch (e) {
            }

            settings.push({
                key: 'adaptiveBitrate',
                title: 'Adaptive Bitrate Streaming',
                description: 'Adaptive Bitrate adjusts the bitrate of the native camera stream on demand to accomodate available bandwidth. If the camera\'s primary stream is being recorded by an NVR, Adaptive Bitrate should be used on a secondary stream (sub stream), as it will reduce the recording quality.',
                choices: [
                    'Local Stream',
                    'Remote Stream',
                    'Apple Watch',
                ],
                multiple: true,
                value: adaptiveBitrate,
            })
        }

        settings.push({
            title: 'RTP Sender',
            key: 'rtpSender',
            description: 'The RTP Sender used by Scrypted. FFMpeg is stable. Scrypted is experimental and much faster.',
            choices: [
                'Default',
                'Scrypted',
                'FFmpeg',
            ],
            value: this.storage.getItem('rtpSender') || 'Default',
        });

        settings.push({
            title: 'Transcoding Debug Mode',
            key: 'transcodingDebugMode',
            description: 'Force transcoding on this camera for streaming and recording. This setting can be used to diagnose errors with HomeKit functionality. Enable the Rebroadcast plugin for more robust transcoding options.',
            type: 'boolean',
            value: (this.storage.getItem('transcodingDebugMode') === 'true').toString(),
        });

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
                const classes = types?.classes?.filter(c => c !== 'motion');
                if (classes?.length) {
                    const value: string[] = [];
                    try {
                        value.push(...JSON.parse(this.storage.getItem('objectDetectionContactSensors')));
                    }
                    catch (e) {
                    }

                    settings.push({
                        title: 'Object Detection Sensors',
                        type: 'string',
                        choices: classes,
                        multiple: true,
                        key: 'objectDetectionContactSensors',
                        description: 'Create HomeKit occupancy sensors that detect specific people or objects.',
                        value,
                    });

                    settings.push({
                        title: 'Object Detection Timeout',
                        type: 'number',
                        key: 'objectDetectionContactSensorTimeout',
                        description: 'Duration in seconds the sensor will report as occupied, before resetting.',
                        value: this.storage.getItem('objectDetectionContactSensorTimeout') || defaultObjectDetectionContactSensorTimeout,
                    });
                }

            }
            catch (e) {
            }
        }

        if (this.interfaces.includes(ScryptedInterface.OnOff)) {
            settings.push({
                title: 'Camera Status Indicator',
                description: 'Allow HomeKit to control the camera status indicator light.',
                key: 'statusIndicator',
                value: this.storage.getItem('statusIndicator') === 'true',
                type: 'boolean',
            });
        }

        return [...settings, ...await super.getMixinSettings()];
    }

    async putMixinSetting(key: string, value: SettingValue) {
        if (this.storageSettings.settings[key]) {
            return super.putMixinSetting(key, value);
        }

        if (key === 'objectDetectionContactSensors') {
            this.storage.setItem(key, JSON.stringify(value));
        }
        else {
            this.storage.setItem(key, value?.toString());
        }

        if (key === 'detectAudio' || key === 'linkedMotionSensor' || key === 'objectDetectionContactSensors') {
            super.alertReload();
        }

        deviceManager.onMixinEvent(this.id, this.mixinProviderNativeId, ScryptedInterface.Settings, undefined);
    }
}
