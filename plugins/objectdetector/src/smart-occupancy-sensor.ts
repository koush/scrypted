import sdk, { Camera, ClipPath, EventListenerRegister, Image, ObjectDetection, ObjectDetector, ObjectsDetected, OccupancySensor, Readme, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, ScryptedNativeId, Setting, SettingValue, Settings } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { levenshteinDistance } from "./edit-distance";
import type { ObjectDetectionPlugin } from "./main";
import { normalizeBox, polygonIntersectsBoundingBox } from "./polygon";

export const SMART_OCCUPANCYSENSOR_PREFIX = 'smart-occupancysensor-';

const nvrAcceleratedMotionSensorId = sdk.systemManager.getDeviceById('@scrypted/nvr', 'motion')?.id;

export class SmartOccupancySensor extends ScryptedDeviceBase implements Settings, Readme, OccupancySensor {
    storageSettings = new StorageSettings(this, {
        camera: {
            title: 'Camera',
            description: 'Select the camera or doorbell image to analyze periodically.',
            type: 'device',
            deviceFilter: `(type === '${ScryptedDeviceType.Doorbell}' || type === '${ScryptedDeviceType.Camera}') && interfaces.includes('${ScryptedInterface.Camera}')`,
            immediate: true,
        },
        objectDetection: {
            title: 'Object Detector',
            description: 'Select the object detection plugin to use for detecting objects.',
            type: 'device',
            deviceFilter: `interfaces.includes('ObjectDetectionPreview') && id !== '${nvrAcceleratedMotionSensorId}'`,
            immediate: true,
        },
        detections: {
            title: 'Detections',
            description: 'The detections that will trigger this occupancy sensor.',
            multiple: true,
            choices: [],
        },
        occupancyInterval: {
            title: 'Occupancy Check Interval',
            description: 'The interval in minutes that the sensor will check for occupancy.',
            type: 'number',
            defaultValue: 60,
            // save and restore in seconds for consistency.
            mapPut(oldValue, newValue) {
                return newValue * 60;
            },
            mapGet(value) {
                return value / 60;
            },
        },
        zone: {
            title: 'Edit Intersect Zone',
            description: 'Optional: Configure the intersect zone for the occupancy check. Objects intersecting this zone will trigger the occupancy sensor.',
            type: 'clippath',
        },
        captureZone: {
            title: 'Edit Crop Zone',
            description: 'Optional: Configure the capture zone for the occupancy check. The image will be cropped to this zone before detection. Cropping to desired location will improve detection performance.',
            type: 'clippath',
        },
        minScore: {
            title: 'Minimum Score',
            description: 'The minimum score required for a detection to trigger the occupancy sensor.',
            type: 'number',
            defaultValue: 0.4,
        },
        labels: {
            group: 'Recognition',
            title: 'Labels',
            description: 'The labels (license numbers, names) that will trigger this smart occupancy sensor.',
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
            description: 'The minimum score required for a label to trigger the occupancy sensor.',
            type: 'number',
            defaultValue: 0,
        }
    });

    detectionListener: EventListenerRegister;
    occupancyTimeout: NodeJS.Timeout;
    occupancyInterval: NodeJS.Timeout;

    constructor(public plugin: ObjectDetectionPlugin, nativeId?: ScryptedNativeId) {
        super(nativeId);

        this.storageSettings.settings.zone.onGet = async () => {
            return {
                deviceFilter: this.storageSettings.values.camera?.id,
            }
        };

        this.storageSettings.settings.captureZone.onGet = async () => {
            return {
                deviceFilter: this.storageSettings.values.camera?.id,
            }
        };

        this.storageSettings.settings.detections.onGet = async () => {
            const objectDetection: ObjectDetection = this.storageSettings.values.objectDetection;
            const choices = (await objectDetection?.getDetectionModel())?.classes || [];
            return {
                hide: !objectDetection,
                choices,
            };
        };

        this.storageSettings.settings.detections.onPut = () => this.rebind();
        this.storageSettings.settings.objectDetection.onPut = () => this.rebind();
        this.storageSettings.settings.zone.onPut = () => this.rebind();
        this.storageSettings.settings.captureZone.onPut = () => this.rebind();

        this.rebind();
    }

    resetOccupiedTimeout() {
        clearTimeout(this.occupancyTimeout);
        this.occupancyTimeout = undefined;
    }

    clearOccupancyInterval() {
        clearInterval(this.occupancyInterval);
        this.occupancyInterval = undefined;
    }

    trigger() {
        this.resetOccupiedTimeout();
        this.occupied = true;
        const duration: number = this.storageSettings.values.occupancyInterval;
        if (!duration)
            return;
        this.occupancyTimeout = setTimeout(() => {
            this.occupied = false;
        }, duration * 60000 + 10000);
    }

    checkDetection(detections: string[], labels: string[], labelDistance: number, labelScore: number, detected: ObjectsDetected) {
        const match = detected.detections?.find(d => {
            if (d.score && d.score < this.storageSettings.values.minScore)
                return false;
            if (!detections?.includes(d.className))
                return false;
            const zone: ClipPath = this.storageSettings.values.zone;
            if (zone?.length >= 3) {
                if (!d.boundingBox)
                    return false;
                const detectionBox = normalizeBox(d.boundingBox, detected.inputDimensions);
                if (!polygonIntersectsBoundingBox(zone, detectionBox))
                    return false;
            }

            if (!labels?.length)
                return true;

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
            if (!this.occupied)
                this.console.log('Occupancy Sensor triggered on', match);
            this.trigger();
        }
    }

    async runDetection() {
        try {
            const objectDetection: ObjectDetection = this.storageSettings.values.objectDetection;
            if (!objectDetection) {
                this.console.error('no object detection plugin selected');
                return;
            }

            const camera: ScryptedDevice & Camera = this.storageSettings.values.camera;
            if (!camera) {
                this.console.error('no camera selected');
                return;
            }

            const picture = await camera.takePicture({
                reason: 'event',
            });
            const zone: ClipPath = this.storageSettings.values.captureZone;
            let detected: ObjectsDetected;
            if (zone?.length >= 3) {
                const image = await sdk.mediaManager.convertMediaObject<Image>(picture, ScryptedMimeTypes.Image);
                let left = image.width;
                let top = image.height;
                let right = 0;
                let bottom = 0;
                for (const point of zone) {
                    left = Math.min(left, point[0]);
                    top = Math.min(top, point[1]);
                    right = Math.max(right, point[0]);
                    bottom = Math.max(bottom, point[1]);
                }

                left = left * image.width;
                top = top * image.height;
                right = right * image.width;
                bottom = bottom * image.height;

                let width = right - left;
                let height = bottom - top;
                // square it for standard detection
                width = height = Math.max(width, height);
                // recenter it
                left = left + (right - left - width) / 2;
                top = top + (bottom - top - height) / 2;
                // ensure bounds are within image.
                left = Math.max(0, left);
                top = Math.max(0, top);
                width = Math.min(width, image.width - left);
                height = Math.min(height, image.height - top);

                const cropped = await image.toImage({
                    crop: {
                        left,
                        top,
                        width,
                        height,
                    },
                });
                detected = await objectDetection.detectObjects(cropped);

                // adjust the origin of the bounding boxes for the crop.
                for (const d of detected.detections) {
                    d.boundingBox[0] += left;
                    d.boundingBox[1] += top;
                }
                detected.inputDimensions = [image.width, image.height];
            }
            else {
                detected = await objectDetection.detectObjects(picture);
            }

            this.checkDetection(this.storageSettings.values.detections, this.storageSettings.values.labels, this.storageSettings.values.labelDistance, this.storageSettings.values.labelScore, detected);
        }
        catch (e) {
            this.console.error('failed to take picture', e);
        }
    }

    rebind() {
        this.occupied = false;
        this.detectionListener?.removeListener();
        this.detectionListener = undefined;
        this.resetOccupiedTimeout();
        this.clearOccupancyInterval();

        this.runDetection();
        this.occupancyInterval = setInterval(() => {
            this.runDetection();
        }, this.storageSettings.values.occupancyInterval * 60000);

        // camera may have an object detector that can also be observed for occupancy for free.
        const objectDetector: ObjectDetector & ScryptedDevice = this.storageSettings.values.camera;
        if (!objectDetector)
            return;

        const detections: string[] = this.storageSettings.values.detections;
        if (!detections?.length)
            return;

        const { labels, labelDistance, labelScore } = this.storageSettings.values;

        this.detectionListener = objectDetector.listen(ScryptedInterface.ObjectDetector, (source, details, data) => {
            const detected: ObjectsDetected = data;
            this.checkDetection(detections, labels, labelDistance, labelScore, detected);
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
## Smart Occupancy Sensor

This Occupancy Sensor remains triggered while specified objects (vehicle, person, animal, etc) are detected on a camera. The sensor can then be synced to other platforms such as HomeKit, Google Home, Alexa, or Home Assistant for use in automations. This Sensor requires an object detector plugin such as Scrypted NVR, OpenVINO, CoreML, ONNX, or Tensorflow-lite.`;
    }
}
