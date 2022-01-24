import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, EventListenerRegister, ObjectDetector, ObjectDetection, ScryptedDevice, ObjectDetectionResult, ObjectDetectionTypes, ObjectsDetected, MotionSensor, MediaStreamOptions, MixinDeviceBase, ScryptedNativeId, DeviceState } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { alertRecommendedPlugins } from '@scrypted/common/src/alert-recommended-plugins';
import { DenoisedDetectionEntry, denoiseDetections } from './denoise';
import { AutoenableMixinProvider } from "../../../common/src/autoenable-mixin-provider"

const polygonOverlap = require('polygon-overlap');

export interface DetectionInput {
  jpegBuffer?: Buffer;
  input: any;
}

const { mediaManager, systemManager, log } = sdk;

const defaultDetectionDuration = 60;
const defaultDetectionInterval = 60;
const defaultDetectionTimeout = 10;
const defaultMotionDuration = 10;

const DETECT_PERIODIC_SNAPSHOTS = "Periodic Snapshots";
const DETECT_MOTION_SNAPSHOTS = "Motion Snapshots";
const DETECT_VIDEO_MOTION = "Video Motion";

type ClipPath = [number, number][];
type Zones = { [zone: string]: ClipPath };

class ObjectDetectionMixin extends SettingsMixinDeviceBase<VideoCamera & Camera & MotionSensor & ObjectDetector> implements ObjectDetector, Settings {
  released = false;
  motionListener: EventListenerRegister;
  detectionListener: EventListenerRegister;
  detectorListener: EventListenerRegister;
  detections = new Map<string, DetectionInput>();
  cameraDevice: ScryptedDevice & Camera & VideoCamera & MotionSensor;
  detectSnapshotsOnly = this.storage.getItem('detectionMode');
  detectionModes = this.getDetectionModes();
  detectionTimeout = parseInt(this.storage.getItem('detectionTimeout')) || defaultDetectionTimeout;
  detectionDuration = parseInt(this.storage.getItem('detectionDuration')) || defaultDetectionDuration;
  motionDuration = parseInt(this.storage.getItem('motionDuration')) || defaultMotionDuration;
  motionAsObjects = this.storage.getItem('motionAsObjects') === 'true';
  motionTimeout: NodeJS.Timeout;
  detectionInterval = parseInt(this.storage.getItem('detectionInterval')) || defaultDetectionInterval;
  zones = this.getZones();
  detectionIntervalTimeout: NodeJS.Timeout;
  currentDetections: DenoisedDetectionEntry<ObjectDetectionResult>[] = [];
  detectionId: string;
  running = false;
  hasMotionType: boolean;
  settings: Setting[];

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string, public objectDetection: ObjectDetection & ScryptedDevice, modelName: string, group: string, public internal: boolean) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group,
      groupKey: "objectdetectionplugin:" + objectDetection.id,
      mixinStorageSuffix: objectDetection.id,
    });

    this.cameraDevice = systemManager.getDeviceById<Camera & VideoCamera & MotionSensor>(this.id);
    this.detectionId = internal ? modelName : modelName + '-' + this.cameraDevice.id;

    this.bindObjectDetection();
    this.register();
    this.resetDetectionTimeout();
  }

  getDetectionModes(): string[] {
    try {
      return JSON.parse(this.storage.getItem('detectionModes'));
    }
    catch (e) {
      return [
        DETECT_PERIODIC_SNAPSHOTS,
        DETECT_VIDEO_MOTION,
        DETECT_MOTION_SNAPSHOTS,
      ];
    }
  }

  clearDetectionTimeout() {
    clearTimeout(this.detectionIntervalTimeout);
    this.detectionIntervalTimeout = undefined;
  }

  resetDetectionTimeout() {
    this.clearDetectionTimeout();
    this.detectionIntervalTimeout = setInterval(() => {
      if ((!this.running && this.detectionModes.includes(DETECT_PERIODIC_SNAPSHOTS)) || this.hasMotionType) {
        this.snapshotDetection();
      }
    }, this.detectionInterval * 1000);
  }

  clearMotionTimeout() {
    clearTimeout(this.motionTimeout);
    this.motionTimeout = undefined;
  }

  resetMotionTimeout() {
    this.clearMotionTimeout();
    this.motionTimeout = setTimeout(() => {
      this.motionDetected = false;
    }, this.motionDuration * 1000);
  }

  async ensureSettings(): Promise<Setting[]> {
    if (this.hasMotionType !== undefined)
      return;
    this.hasMotionType = false;
    const model = await this.objectDetection.getDetectionModel();
    this.hasMotionType = model.classes.includes('motion');
    this.settings = model.settings;
    this.motionDetected = false;
  }

  async getCurrentSettings() {
    await this.ensureSettings();
    if (!this.settings)
      return;

    const ret: any = {};
    for (const setting of this.settings) {
      ret[setting.key] = this.storage.getItem(setting.key) || setting.value;
    }

    return ret;
  }

  async snapshotDetection() {
    await this.ensureSettings();

    if (this.hasMotionType) {
      await this.startVideoDetection();
      return;
    }

    const picture = await this.cameraDevice.takePicture();
    const detections = await this.objectDetection.detectObjects(picture, {
      detectionId: this.detectionId,
      settings: await this.getCurrentSettings(),
    });
    this.objectsDetected(detections, true);
    this.reportObjectDetections(detections, undefined);
  }

  bindObjectDetection() {
    this.running = false;
    this.detectionListener?.removeListener();
    this.detectionListener = undefined;
    this.detectorListener?.removeListener();
    this.detectorListener = undefined;
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
    });

    this.detectionListener = this.objectDetection.listen({
      event: ScryptedInterface.ObjectDetection,
      watch: false,
    }, (eventSource, eventDetails, eventData: ObjectsDetected) => {
      if (eventData?.detectionId !== this.detectionId)
        return;
      this.objectsDetected(eventData);
      this.reportObjectDetections(eventData, undefined);

      this.running = eventData.running;
    });

    if (this.detectionModes.includes(DETECT_PERIODIC_SNAPSHOTS))
      this.snapshotDetection();

    if (this.detectionModes.includes(DETECT_MOTION_SNAPSHOTS)) {
      this.detectorListener = this.cameraDevice.listen(ScryptedInterface.ObjectDetector, async (eventSource, eventDetails, eventData: ObjectsDetected) => {
        if (!eventData?.detections?.find(d => d.className === 'motion'))
          return;
        if (!eventData?.eventId)
          return;
        const od = eventSource as any as ObjectDetector;
        const mo = await od.getDetectionInput(eventData.detectionId, eventData.eventId);
        const detections = await this.objectDetection.detectObjects(mo, {
          detectionId: this.detectionId,
          settings: await this.getCurrentSettings(),
        });
        this.objectsDetected(detections, true);
        this.reportObjectDetections(detections, eventData.detectionId);
      });
    }
  }

  async register() {
    this.motionListener = this.cameraDevice.listen(ScryptedInterface.MotionSensor, async () => {
      if (!this.cameraDevice.motionDetected)
        return;

      if (this.detectionModes.includes(DETECT_VIDEO_MOTION))
        await this.startVideoDetection();
    });
  }

  async startVideoDetection() {
    try {
      // prevent stream retrieval noise until notified that the detection is no longer running.
      if (this.running) {
        const session = await this.objectDetection?.detectObjects(undefined, {
          detectionId: this.detectionId,
          duration: this.getDetectionDuration(),
          settings: await this.getCurrentSettings(),
        });
        this.running = session.running;
        if (this.running)
          return;
      }
      this.running = true;

      let selectedStream: MediaStreamOptions;
      let stream: MediaObject;

      // intenral streams must implicitly be available.
      if (!this.internal) {
        const streamingChannel = this.storage.getItem('streamingChannel');
        if (streamingChannel) {
          const msos = await this.cameraDevice.getVideoStreamOptions();
          selectedStream = msos.find(mso => mso.name === streamingChannel);
        }

        stream = await this.cameraDevice.getVideoStream(selectedStream);
      }
      else {
        stream = mediaManager.createMediaObject(Buffer.alloc(0), 'x-scrypted/x-internal-media-object');
      }

      const session = await this.objectDetection?.detectObjects(stream, {
        detectionId: this.detectionId,
        duration: this.getDetectionDuration(),
        settings: await this.getCurrentSettings(),
      });

      this.running = session.running;
    }
    catch (e) {
      this.console.log('failure retrieving stream', e);
      this.running = false;
    }
  }

  getDetectionDuration() {
    // when motion type, the detection interval is a keepalive reset.
    // the duration needs to simply be an arbitrarily longer time.
    return this.hasMotionType ? this.detectionInterval * 1000 * 5 : this.detectionDuration * 1000;
  }

  reportObjectDetections(detection: ObjectsDetected, detectionInput?: DetectionInput) {
    if (detectionInput)
      this.setDetection(this.detectionId, detectionInput);

    if (this.hasMotionType) {
      const found = detection.detections?.find(d => d.className === 'motion');
      if (found) {
        if (!this.motionDetected)
          this.motionDetected = true;
        this.resetMotionTimeout();

        const areas = detection.detections.filter(d => d.className === 'motion' && d.score !== 1).map(d => d.score)
        if (areas.length)
          this.console.log('detection areas', areas);
      }
    }

    if (!this.hasMotionType || this.motionAsObjects) {
      if (detection.detections && Object.keys(this.zones).length) {
        for (const o of detection.detections) {
          if (!o.boundingBox)
            continue;
          o.zones = []
          let [x, y, width, height] = o.boundingBox;
          let x2 = x + width;
          let y2 = y + height;
          // the zones are point paths in percentage format
          x = x * 100 / detection.inputDimensions[0];
          y = y * 100 / detection.inputDimensions[1];
          x2 = x2 * 100 / detection.inputDimensions[0];
          y2 = y2 * 100 / detection.inputDimensions[1];
          const box = [[x, y], [x2, y], [x2, y2], [x, y2]];
          for (const [zone, zoneValue] of Object.entries(this.zones)) {
            if (polygonOverlap(box, zoneValue)) {
              this.console.log(o.className, 'inside', zone);
              o.zones.push(zone);
            }
          }
        }
      }
      this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
    }
  }

  async extendedObjectDetect() {
    try {
      await this.objectDetection?.detectObjects(undefined, {
        detectionId: this.detectionId,
        duration: this.getDetectionDuration(),
      });
    }
    catch (e) {
      // ignore any
    }
  }

  async objectsDetected(detectionResult: ObjectsDetected, showAll?: boolean) {
    // do not denoise
    if (this.hasMotionType) {
      return;
    }

    if (!detectionResult?.detections) {
      // detection session ended.
      return;
    }

    const { detections } = detectionResult;

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
      if (detectionResult.running)
        this.extendedObjectDetect();
    }
    if (found.length || showAll) {
      this.console.log('current detections:', this.currentDetections.map(d => `${d.detection.className} (${d.detection.score}, ${d.detection.id})`).join(', '));
    }
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
    const ret = await this.getNativeObjectTypes();
    if (!ret.classes)
      ret.classes = [];
    ret.classes.push(...(await this.objectDetection.getDetectionModel()).classes);
    return ret;
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
    const settings: Setting[] = [];

    if (this.hasMotionType && this.mixinDeviceInterfaces.includes(ScryptedInterface.MotionSensor)) {
      settings.push({
        title: 'Existing Motion Sensor',
        description: 'This camera has a built in motion sensor. Using OpenCV Motion Sensing may be unnecessary and will use additional CPU.',
        readonly: true,
        value: 'WARNING',
        key: 'existingMotionSensor',
      })
    }

    let msos: MediaStreamOptions[] = [];
    try {
      msos = await this.cameraDevice.getVideoStreamOptions();
    }
    catch (e) {
    }

    if (!this.hasMotionType) {
      settings.push({
        title: 'Detection Modes',
        description: 'Configure when to analyze the video stream. Video Motion can be CPU intensive.',
        key: 'detectionModes',
        type: 'string',
        multiple: true,
        choices: [
          DETECT_PERIODIC_SNAPSHOTS,
          DETECT_VIDEO_MOTION,
          DETECT_MOTION_SNAPSHOTS,
        ],
        value: this.detectionModes,
      });

      if (this.detectionModes.includes(DETECT_VIDEO_MOTION)) {
        if (msos?.length && !this.internal) {
          settings.push({
            title: 'Video Stream',
            key: 'streamingChannel',
            value: this.storage.getItem('streamingChannel') || msos[0].name,
            description: 'The media stream to analyze.',
            choices: msos.map(mso => mso.name),
          });
        }

        settings.push(
          {
            title: 'Detection Duration',
            description: 'The duration in seconds to analyze video when motion occurs.',
            key: 'detectionDuration',
            type: 'number',
            value: this.detectionDuration.toString(),
          }
        );
      }

      if (this.detectionModes.includes(DETECT_PERIODIC_SNAPSHOTS)) {
        settings.push(
          {
            title: 'Idle Detection Interval',
            description: 'The interval in seconds to analyze snapshots when there is no motion.',
            key: 'detectionInterval',
            type: 'number',
            value: this.detectionInterval.toString(),
          }
        );
      }

      settings.push(
        {
          title: 'Detection Timeout',
          description: 'Timeout in seconds before removing an object that is no longer detected.',
          key: 'detectionTimeout',
          type: 'number',
          value: this.detectionTimeout.toString(),
        },
      );
    }
    else {
      if (msos?.length && !this.internal) {
        settings.push({
          title: 'Video Stream',
          key: 'streamingChannel',
          value: this.storage.getItem('streamingChannel') || msos[0].name,
          description: 'The media stream to analyze.',
          choices: msos.map(mso => mso.name),
        });
      }

      settings.push({
        title: 'Motion Duration',
        description: 'The duration in seconds to wait to reset the motion sensor.',
        key: 'motionDuration',
        type: 'number',
        value: this.motionDuration.toString(),
      },
        {
          title: 'Motion Detection Objects',
          description: 'Report motion detections as objects (useful for debugging).',
          key: 'motionAsObjects',
          type: 'boolean',
          value: this.motionAsObjects,
        }
      );
    }

    if (this.settings) {
      settings.push(...this.settings.map(setting =>
        Object.assign({}, setting, {
          placeholder: setting.placeholder?.toString(),
          value: this.storage.getItem(setting.key) || setting.value,
        } as Setting))
      );
    }

    if (!this.hasMotionType) {
      settings.push(
        {
          title: 'Analyze',
          description: 'Analyzes the video stream for 1 minute. Results will be shown in the Console.',
          key: 'analyzeButton',
          type: 'button',
        }
      );
    }

    settings.push({
      key: 'zones',
      title: 'Zones',
      type: 'string',
      multiple: true,
      value: Object.keys(this.zones),
      choices: Object.keys(this.zones),
      combobox: true,
    });

    for (const [name, value] of Object.entries(this.zones)) {
      settings.push({
        key: `zone-${name}`,
        title: `Edit Zone: ${name}`,
        type: 'clippath',
        value: JSON.stringify(value),
      });
    }

    return settings;
  }

  getZones(): Zones {
    try {
      return JSON.parse(this.storage.getItem('zones'));
    }
    catch (e) {
      return {};
    }
  }

  async putMixinSetting(key: string, value: string | number | boolean | string[] | number[]): Promise<void> {
    const vs = value?.toString();

    if (key === 'zones') {
      const newZones: Zones = {};
      for (const name of value as string[]) {
        newZones[name] = this.zones[name] || [];
      }
      this.zones = newZones;
      this.storage.setItem('zones', JSON.stringify(newZones));
      return;
    }
    if (key.startsWith('zone-')) {
      this.zones[key.substring(5)] = JSON.parse(vs);
      this.storage.setItem('zones', JSON.stringify(this.zones));
      return;
    }

    this.storage.setItem(key, vs);
    if (key === 'detectionDuration') {
      this.detectionDuration = parseInt(vs) || defaultDetectionDuration;
    }
    else if (key === 'detectionInterval') {
      this.detectionInterval = parseInt(vs) || defaultDetectionInterval;
      this.resetDetectionTimeout();
    }
    else if (key === 'detectionTimeout') {
      this.detectionTimeout = parseInt(vs) || defaultDetectionTimeout;
    }
    else if (key === 'motionDuration') {
      this.motionDuration = parseInt(vs) || defaultMotionDuration;
    }
    else if (key === 'motionAsObjects') {
      this.motionAsObjects = vs === 'true';
    }
    else if (key === 'streamingChannel') {
      this.bindObjectDetection();
    }
    else if (key === 'analyzeButton') {
      await this.snapshotDetection();
      await this.startVideoDetection();
      await this.extendedObjectDetect();
    }
    else if (key === 'detectionModes') {
      this.storage.setItem(key, JSON.stringify(value));
      this.detectionModes = this.getDetectionModes();
      this.bindObjectDetection();
    }
    else {
      const settings = await this.getCurrentSettings();
      if (settings && settings[key]) {
        settings[key] = value;
      }
      this.bindObjectDetection();
    }
  }

  release() {
    super.release();
    this.released = true;
    this.clearDetectionTimeout();
    this.clearMotionTimeout();
    this.motionListener?.removeListener();
    this.detectionListener?.removeListener();
    this.detectorListener?.removeListener();
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
    });
  }
}

class ObjectDetectorMixin extends MixinDeviceBase<ObjectDetection> implements MixinProvider {
  constructor(mixinDevice: ObjectDetection, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState, mixinProviderNativeId: ScryptedNativeId, public modelName: string, public internal?: boolean) {
    super(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, mixinProviderNativeId);

    // trigger mixin creation. todo: fix this to not be stupid hack.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera & Settings>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.probe();

    }
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    // filter out 
    for (const iface of interfaces) {
      if (iface.startsWith(`${ScryptedInterface.ObjectDetection}:`)) {
        const deviceMatch = this.mixinDeviceInterfaces.find(miface => miface.startsWith(iface));
        if (deviceMatch)
          continue;
        return null;
      }
    }

    if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) && (interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.Camera))) {
      return [ScryptedInterface.ObjectDetector, ScryptedInterface.MotionSensor, ScryptedInterface.Settings];
    }
    return null;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    let objectDetection = systemManager.getDeviceById<ObjectDetection>(this.id);
    const group = objectDetection.name;
    return new ObjectDetectionMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.mixinProviderNativeId, objectDetection, this.modelName, group, this.internal);
  }

  async releaseMixin(id: string, mixinDevice: any) {
    this.console.log('releasing ObjectDetection mixin', id);
    mixinDevice.release();
  }
}

class ObjectDetectionPlugin extends AutoenableMixinProvider {
  constructor(nativeId?: ScryptedNativeId) {
    super(nativeId);

    alertRecommendedPlugins({
      '@scrypted/opencv': "OpenCV Motion Detection Plugin",
      // '@scrypted/tensorflow': 'TensorFlow Face Recognition Plugin',
      // '@scrypted/tensorflow-lite': 'TensorFlow Lite Object Detection Plugin',
    });
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.ObjectDetection))
      return;
    return [ScryptedInterface.MixinProvider];
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
    for (const iface of mixinDeviceInterfaces) {
      if (iface.startsWith(`${ScryptedInterface.ObjectDetection}:`)) {
        const model = await mixinDevice.getDetectionModel();

        return new ObjectDetectorMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId, model.name, true);
      }
    }

    const model = await mixinDevice.getDetectionModel();
    return new ObjectDetectorMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId, model.name);
  }

  async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    // what does this mean to make a mixin provider no longer available?
    // just ignore it until reboot?
  }
}

export default new ObjectDetectionPlugin();
