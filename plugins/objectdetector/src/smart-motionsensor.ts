import sdk, { Camera, EventListenerRegister, MediaObject, MotionSensor, ObjectDetector, ObjectsDetected, Readme, RequestPictureOptions, ResponsePictureOptions, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, SettingValue, Settings } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { levenshteinDistance } from "./edit-distance";
import type { ObjectDetectionPlugin } from "./main";

export const SMART_MOTIONSENSOR_PREFIX = 'smart-motionsensor-';

export class SmartMotionSensor extends ScryptedDeviceBase implements Settings, Readme, MotionSensor, Camera {
    storageSettings = new StorageSettings(this, {
        objectDetector: {
            title: 'Camera',
            description: 'Select a camera or doorbell that provides smart detection events.',
            type: 'device',
            deviceFilter: `(type === '${ScryptedDeviceType.Doorbell}' || type === '${ScryptedDeviceType.Camera}') && interfaces.includes('${ScryptedInterface.ObjectDetector}')`,
        },
        detections: {
            title: 'Detections',
            description: 'The detections that will trigger this smart motion sensor.',
            multiple: true,
            choices: [],
        },
        detectionTimeout: {
            title: 'Object Detection Timeout',
            description: 'Duration in seconds the sensor will report motion, before resetting. Setting this to 0 will reset the sensor when motion stops.',
            type: 'number',
            defaultValue: 60,
        },
        zones: {
            title: 'Zones',
            description: 'Optional: The sensor will only be triggered when an object is in any of the following zones.',
            multiple: true,
            combobox: true,
            choices: [
            ],
        },
        minScore: {
            title: 'Minimum Score',
            description: 'The minimum score required for a detection to trigger the motion sensor.',
            type: 'number',
            defaultValue: 0.7,
        },
        requireDetectionThumbnail: {
            title: 'Require Detections with Images',
            description: 'When enabled, this sensor will ignore detections results that do not have images.',
            type: 'boolean',
            defaultValue: false,
        },
        requireScryptedNvrDetections: {
            title: 'Require Scrypted Detections',
            description: 'When enabled, this sensor will ignore onboard camera detections.',
            type: 'boolean',
            defaultValue: false,
        },
        labels: {
            group: 'Recognition',
            title: 'Labels',
            description: 'The labels (license numbers, names) that will trigger this smart motion sensor.',
            multiple: true,
            combobox: true,
            choices: [],
        },
        labelDistance: {
            group: 'Recognition',
            title: 'Label Distance',
            description: 'The maximum edit distance between the detected label and the desired label. Ie, a distance of 1 will match "abcde" to "abcbe" or "abcd".',
            type: 'number',
            defaultValue: 2,
        },
        labelScore: {
            group: 'Recognition',
            title: 'Label Score',
            description: 'The minimum score required for a label to trigger the motion sensor.',
            type: 'number',
            defaultValue: 0,
        }
    });

    detectionListener: EventListenerRegister;
    motionListener: EventListenerRegister;
    timeout: NodeJS.Timeout;
    lastPicture: Promise<MediaObject>;

    constructor(public plugin: ObjectDetectionPlugin, nativeId?: ScryptedNativeId) {
        super(nativeId);

        this.storageSettings.settings.detections.onGet = async () => {
            const objectDetector: ObjectDetector = this.storageSettings.values.objectDetector;
            const choices = (await objectDetector?.getObjectTypes?.())?.classes || [];
            return {
                hide: !objectDetector,
                choices,
            };
        };

        this.storageSettings.settings.detections.onPut = () => this.rebind();

        this.storageSettings.settings.objectDetector.onPut = () => this.rebind();

        this.storageSettings.settings.zones.onPut = () => this.rebind();

        this.storageSettings.settings.zones.onGet = async () => {
            const objectDetector: ObjectDetector & ScryptedDevice = this.storageSettings.values.objectDetector;
            const objectDetections = [...this.plugin.currentMixins.values()]
                .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat();

            const mixin = objectDetections.find(m => m.id === objectDetector?.id);
            const zones = new Set(Object.keys(mixin?.getZones() || {}));
            for (const z of this.storageSettings.values.zones || []) {
                zones.add(z);
            }

            return {
                choices: [...zones],
            };
        };

        this.rebind();

        if (!this.providedInterfaces.includes(ScryptedInterface.Camera)) {
            sdk.deviceManager.onDeviceDiscovered({
                name: this.providedName,
                nativeId: this.nativeId,
                type: this.providedType,
                interfaces: [
                    ScryptedInterface.Camera,
                    ScryptedInterface.MotionSensor,
                    ScryptedInterface.Settings,
                    ScryptedInterface.Readme,
                ]
            })
        }
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        return this.lastPicture;
    }

    async getPictureOptions(): Promise<ResponsePictureOptions[]> {
        return;
    }

    resetMotionTimeout() {
        clearTimeout(this.timeout);
        this.timeout = undefined;
    }

    trigger() {
        this.resetMotionTimeout();
        this.motionDetected = true;
        const duration: number = this.storageSettings.values.detectionTimeout;
        if (!duration)
            return;
        this.timeout = setTimeout(() => {
            this.motionDetected = false;
        }, duration * 1000);
    }

    rebind() {
        this.motionDetected = false;
        this.detectionListener?.removeListener();
        this.detectionListener = undefined;
        this.motionListener?.removeListener();
        this.motionListener = undefined;
        this.resetMotionTimeout();


        const objectDetector: ObjectDetector & MotionSensor & ScryptedDevice = this.storageSettings.values.objectDetector;
        if (!objectDetector)
            return;

        const detections: string[] = this.storageSettings.values.detections;
        if (!detections?.length)
            return;

        this.motionListener = objectDetector.listen({
            event: ScryptedInterface.MotionSensor,
            watch: true,
        }, (source, details, data) => {
            const duration: number = this.storageSettings.values.detectionTimeout;
            if (duration)
                return;

            if (!objectDetector.motionDetected)
                this.motionDetected = false;
        });

        this.detectionListener = objectDetector.listen(ScryptedInterface.ObjectDetector, (source, details, data) => {
            const detected: ObjectsDetected = data;

            if (this.storageSettings.values.requireDetectionThumbnail && !detected.detectionId)
                return false;

            const { labels, labelDistance, labelScore } = this.storageSettings.values;

            const match = detected.detections?.find(d => {
                if (this.storageSettings.values.requireScryptedNvrDetections && !d.boundingBox)
                    return false;
                if (d.score && d.score < this.storageSettings.values.minScore)
                    return false;
                if (!detections.includes(d.className))
                    return false;
                const zones: string[] = this.storageSettings.values.zones;
                if (zones?.length) {
                    if (d.zones) {
                        let found = false;
                        for (const z of d.zones) {
                            if (zones.includes(z)) {
                                found = true;
                                break;
                            }
                        }
                        if (!found)
                            return false;
                    }
                    else {
                        this.console.warn('Camera does not provide Zones in detection event. Zone filter will not be applied.');
                    }
                }

                // when not searching for a label, validate the object is moving.
                if (!labels?.length)
                    return !d.movement || d.movement.moving;

                if (!d.label)
                    return false;

                for (const label of labels) {
                    if (label === d.label) {
                        if (!labelScore || d.labelScore >= labelScore)
                            return true;
                        this.console.log('Label score too low.', d.labelScore);
                        continue;
                    }

                    if (!labelDistance)
                        continue;

                    if (levenshteinDistance(label, d.label) > labelDistance) {
                        this.console.log('Label does not match.', label, d.label, d.labelScore);
                        continue;
                    }

                    if (!labelScore || d.labelScore >= labelScore)
                        return true;
                    this.console.log('Label score too low.', d.labelScore);
                }

                return false;
            });

            if (match) {
                if (!this.motionDetected)
                    this.console.log('Smart Motion Sensor triggered on', match);
                if (detected.detectionId)
                    this.lastPicture = objectDetector.getDetectionInput(detected.detectionId, details.eventId);
                this.trigger();
            }
        });
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async getReadmeMarkdown(): Promise<string> {
        return `
## Smart Motion Sensor

This Smart Motion Sensor can trigger when a specific type of object (vehicle, person, animal, etc) triggers movement on a camera. The sensor can then be synced to other platforms such as HomeKit, Google Home, Alexa, or Home Assistant for use in automations. This Sensor requires a camera with hardware or software object detection capability.`;
    }
}
