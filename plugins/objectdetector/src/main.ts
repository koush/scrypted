import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, EventListenerRegister, ObjectDetector, ObjectDetection, ScryptedDeviceBase, ScryptedDevice, ObjectDetectionResult, FaceRecognitionResult, ObjectDetectionTypes, ObjectsDetected, MotionSensor } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { randomBytes } from 'crypto';
import { DenoisedDetectionEntry, denoiseDetections } from './denoise';

export interface DetectionInput {
  jpegBuffer?: Buffer;
  input: any;
}

const { mediaManager, systemManager, log } = sdk;

const defaultMinConfidence = 0.7;
const defaultDetectionDuration = 60;
const defaultDetectionInterval = 60;
const defaultDetectionTimeout = 10;

class ObjectDetectionMixin extends SettingsMixinDeviceBase<ObjectDetector> implements ObjectDetector, Settings {
  released = false;
  motionListener: EventListenerRegister;
  detectionListener: EventListenerRegister;
  detections = new Map<string, DetectionInput>();
  realDevice: ScryptedDevice & Camera & VideoCamera & ObjectDetector & MotionSensor;
  minConfidence = parseFloat(this.storage.getItem('minConfidence')) || defaultMinConfidence;
  detectionTimeout = parseInt(this.storage.getItem('detectionTimeout')) || defaultDetectionTimeout;
  detectionDuration = parseInt(this.storage.getItem('detectionDuration')) || defaultDetectionDuration;
  detectionInterval = parseInt(this.storage.getItem('detectionInterval')) || defaultDetectionInterval;
  detectionIntervalTimeout: NodeJS.Timeout;
  currentDetections: DenoisedDetectionEntry<ObjectDetectionResult>[] = [];
  currentPeople: DenoisedDetectionEntry<FaceRecognitionResult>[] = [];
  objectDetection: ObjectDetection & ScryptedDevice;
  detectionId = randomBytes(8).toString('hex');

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, public objectDetectionPlugin: ObjectDetectionPlugin) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId: objectDetectionPlugin.nativeId,
      mixinDeviceInterfaces,
      group: "Object Detection Settings",
      groupKey: "objectdetectionplugin",
    });

    this.realDevice = systemManager.getDeviceById<Camera & VideoCamera & ObjectDetector & MotionSensor>(this.id);

    this.bindObjectDetection();
    this.register();
    this.resetDetectionTimeout();

    this.detectPicture();
  }

  clearDetectionTimeout() {
    clearTimeout(this.detectionIntervalTimeout);
    this.detectionIntervalTimeout = undefined;
  }

  resetDetectionTimeout() {
    this.clearDetectionTimeout();
    this.detectionIntervalTimeout = setInterval(() => this.detectPicture(), this.detectionInterval * 1000);
  }

  async detectPicture() {
    const picture = await this.realDevice.takePicture();
    const detections = await this.objectDetection.detectObjects(picture, {
      detectionId: this.detectionId,
      minScore: this.minConfidence,
    });
    this.objectsDetected(detections);
  }

  bindObjectDetection() {
    this.detectionListener?.removeListener();
    this.detectionListener = undefined;
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
    });
    this.objectDetection = undefined;

    this.objectDetection = systemManager.getDeviceById<ObjectDetection>(this.storage.getItem('objectDetection'));
    if (!this.objectDetection) {
      const message = 'Select an object detecton device for ' + this.realDevice.name
      log.a(message);
      this.console.error(message);
      return;
    }

    this.detectionListener = this.objectDetection.listen({
      event: ScryptedInterface.ObjectDetection,
      watch: false,
    }, (eventSource, eventDetails, eventData: ObjectsDetected) => {
      if (eventData?.detectionId !== this.detectionId)
        return;
      this.objectsDetected(eventData);
      this.reportObjectDetections(eventData, undefined);
    });
  }

  async register() {
    this.motionListener = this.realDevice.listen(ScryptedInterface.MotionSensor, async () => {
      if (!this.realDevice.motionDetected)
        return;
      this.resetDetectionTimeout();
      this.objectDetection?.detectObjects(await this.realDevice.getVideoStream(), {
        detectionId: this.detectionId,
        duration: this.detectionDuration * 1000,
        minScore: this.minConfidence,
      });
    });
  }

  reportObjectDetections(detection: ObjectsDetected, detectionInput?: DetectionInput) {
    if (detectionInput)
      this.setDetection(this.detectionId, detectionInput);

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
  }

  async extendedObjectDetect() {
    try {
      await this.objectDetection?.detectObjects(undefined, {
        detectionId: this.detectionId,
        duration: this.detectionDuration * 1000,
      });
    }
    catch (e) {
      // ignore any
    }
  }

  async objectsDetected(detectionResult: ObjectsDetected) {
    this.resetDetectionTimeout();
    if (!detectionResult?.detections) {
      // detection session ended.
      return;
    }

    const detections = detectionResult.detections.filter(d => d.score >= this.minConfidence);

    const found: DenoisedDetectionEntry<ObjectDetectionResult>[] = [];
    denoiseDetections<ObjectDetectionResult>(this.currentDetections, detections.map(detection => ({
      id: detection.id,
      name: detection.className,
      detection,
    })), {
      timeout: this.detectionTimeout * 1000,
      added: d => found.push(d),
      removed: d => {
        this.console.log('expired detection:', `${d.detection.className} (${d.detection.score}, ${d.detection.id})`);
        if (detectionResult.running)
          this.extendedObjectDetect();
      }
    });
    if (found.length) {
      this.console.log('new detection:', found.map(d => `${d.detection.className} (${d.detection.score}, ${d.detection.id})`).join(', '));
      this.console.log('current detections:', this.currentDetections.map(d => `${d.detection.className} (${d.detection.score}, ${d.detection.id})`).join(', '));
      if (detectionResult.running)
        this.extendedObjectDetect();
    }
  }

  async peopleDetected(detectionResult: ObjectsDetected) {
    if (!detectionResult?.people) {
      return;
    }

    const found: DenoisedDetectionEntry<FaceRecognitionResult>[] = [];
    denoiseDetections<FaceRecognitionResult>(this.currentPeople, detectionResult.people.map(detection => ({
      id: detection.id,
      name: detection.label,
      detection,
    })), {
      timeout: this.detectionTimeout * 1000,
      added: d => found.push(d),
      removed: d => {
        this.console.log('expired detection:', `${d.detection.label} (${d.detection.score}, ${d.detection.id})`);
        if (detectionResult.running)
          this.extendedFaceDetect();
      }
    });
    if (found.length) {
      this.console.log('new detection:', found.map(d => `${d.detection.label} (${d.detection.score}, ${d.detection.id})`).join(', '));
      this.console.log('current detections:', this.currentDetections.map(d => `${d.detection.className} (${d.detection.score}, ${d.detection.id})`).join(', '));
      this.extendedFaceDetect();
    }
  }

  async extendedFaceDetect() {
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
      duration: 60000,
    });
  }

  setDetection(detectionId: string, detectionInput: DetectionInput) {
    // this.detections.set(detectionId, detectionInput);
    // setTimeout(() => {
    //   this.detections.delete(detectionId);
    //   detectionInput?.input?.dispose();
    // }, DISPOSE_TIMEOUT);
  }

  async getNativeObjectTypes(): Promise<ObjectDetectionTypes> {
    if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
      return this.mixinDevice.getObjectTypes();
    return {};
  }

  async getObjectTypes(): Promise<ObjectDetectionTypes> {
    const models = await this.objectDetection?.getInferenceModels();
    return {
      classes: models?.[0]?.classes || [],
      faces: true,
      people: models?.[0]?.people,
    }
  }

  async getDetectionInput(detectionId: any): Promise<MediaObject> {
    const detection = this.detections.get(detectionId);
    if (!detection) {
      if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
        return this.mixinDevice.getDetectionInput(detectionId);
      return;
    }
    // if (!detection.jpegBuffer) {
    //   detection.jpegBuffer = Buffer.from(await encodeJpeg(detection.input));
    // }
    return mediaManager.createMediaObject(detection.jpegBuffer, 'image/jpeg');
  }

  async getMixinSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Object Detector',
        key: 'objectDetection',
        type: 'device',
        deviceFilter: `interfaces.includes("${ScryptedInterface.ObjectDetection}")`,
        value: this.storage.getItem('objectDetection'),
      },
      {
        title: 'Minimum Detection Confidence',
        description: 'Higher values eliminate false positives and low quality recognition candidates.',
        key: 'minConfidence',
        type: 'number',
        value: this.minConfidence.toString(),
      },
      {
        title: 'Detection Duration',
        description: 'The duration in seconds to analyze video when motion occurs.',
        key: 'detectionDuration',
        type: 'number',
        value: this.detectionDuration.toString(),
      },
      {
        title: 'Idle Detection Interval',
        description: 'The interval in seconds to analyze snapshots when there is no motion.',
        key: 'detectionInterval',
        type: 'number',
        value: this.detectionInterval.toString(),
      },
      {
        title: 'Detection Timeout',
        description: 'Timeout in seconds before removing an object that is no longer detected.',
        key: 'detectionTimeout',
        type: 'number',
        value: this.detectionTimeout.toString(),
      },
    ];
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    const vs = value.toString();
    this.storage.setItem(key, vs);
    if (key === 'minConfidence') {
      this.minConfidence = parseFloat(vs) || defaultMinConfidence;
    }
    else if (key === 'detectionDuration') {
      this.detectionDuration = parseInt(vs) || defaultDetectionDuration;
    }
    else if (key === 'detectionInterval') {
      this.detectionInterval = parseInt(vs) || defaultDetectionInterval;
    }
    else if (key === 'detectionTimeout') {
      this.detectionTimeout = parseInt(vs) || defaultDetectionTimeout;
    }
    else if (key === 'objectDetection') {
      this.bindObjectDetection();
    }
  }

  release() {
    super.release();
    this.released = true;
    this.clearDetectionTimeout();
    this.motionListener?.removeListener();
    this.detectionListener?.removeListener();
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
    });
  }
}

class ObjectDetectionPlugin extends ScryptedDeviceBase implements MixinProvider {
  constructor(nativeId?: string) {
    super(nativeId);

    // trigger mixin creation. todo: fix this to not be stupid hack.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera & Settings>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.probe();
    }
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if ((interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.Camera))
      && interfaces.includes(ScryptedInterface.MotionSensor)) {
      return [ScryptedInterface.ObjectDetector, ScryptedInterface.Settings];
    }
    return null;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    return new ObjectDetectionMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new ObjectDetectionPlugin();
