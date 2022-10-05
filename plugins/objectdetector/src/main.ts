import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, EventListenerRegister, ObjectDetector, ObjectDetection, ScryptedDevice, ObjectDetectionResult, ObjectDetectionTypes, ObjectsDetected, MotionSensor, MediaStreamOptions, MixinDeviceBase, ScryptedNativeId, DeviceState, ObjectDetectionCallbacks } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { alertRecommendedPlugins } from '@scrypted/common/src/alert-recommended-plugins';
import { DenoisedDetectionEntry, DenoisedDetectionState, denoiseDetections } from './denoise';
import { AutoenableMixinProvider } from "../../../common/src/autoenable-mixin-provider"
import { safeParseJson } from './util';
import crypto from 'crypto';

const polygonOverlap = require('polygon-overlap');

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

type TrackedDetection = ObjectDetectionResult & { bestScore?: number };

class ObjectDetectionMixin extends SettingsMixinDeviceBase<VideoCamera & Camera & MotionSensor & ObjectDetector> implements ObjectDetector, Settings, ObjectDetectionCallbacks {
  released = false;
  motionListener: EventListenerRegister;
  detectionListener: EventListenerRegister;
  detectorListener: EventListenerRegister;
  detections = new Map<string, MediaObject>();
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
  detectionState: DenoisedDetectionState<TrackedDetection> = {};
  detectionId: string;
  running = false;
  hasMotionType: boolean;
  settings: Setting[];
  analyzeStarted = 0;

  constructor(mixinDevice: VideoCamera & Camera & MotionSensor & ObjectDetector & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string, public objectDetection: ObjectDetection & ScryptedDevice, modelName: string, group: string, public internal: boolean) {
    super({
      mixinDevice, mixinDeviceState,
      mixinProviderNativeId: providerNativeId,
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
        DETECT_VIDEO_MOTION,
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
      ret[setting.key] = (setting.multiple ? safeParseJson(this.storage.getItem(setting.key)) : this.storage.getItem(setting.key))
        || setting.value;
    }

    return ret;
  }

  async maybeStartMotionDetection() {
    await this.ensureSettings();
    if (this.hasMotionType)
      await this.startVideoDetection();
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
    this.reportObjectDetections(detections);
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
      this.reportObjectDetections(eventData);

      this.running = eventData.running;
    });

    this.maybeStartMotionDetection();

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
        this.setDetection(detections, mo);
        this.reportObjectDetections(detections);
      });
    }
  }

  async register() {
    this.motionListener = this.cameraDevice.listen(ScryptedInterface.MotionSensor, async () => {
      // ignore any motion events if this is a motion detector.
      if (this.hasMotionType)
        return;

      if (!this.cameraDevice.motionDetected) {
        if (this.running) {
          // allow anaysis due to user request.
          if (this.analyzeStarted + 60000 > Date.now())
            return;

          this.console.log('motion stopped, cancelling ongoing detection')
          this.objectDetection?.detectObjects(undefined, {
            detectionId: this.detectionId,
          });
        }
        return;
      }

      if (this.detectionModes.includes(DETECT_VIDEO_MOTION))
        await this.startVideoDetection();
    });
  }

  handleDetectionEvent(detection: ObjectsDetected, mediaObject?: MediaObject) {
    this.running = detection.running;

    const newOrBetterDetection = this.objectsDetected(detection);
    if (newOrBetterDetection)
      this.setDetection(detection, mediaObject);
    this.reportObjectDetections(detection);
    // if (newOrBetterDetection) {
    //   mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg')
    //     .then(jpeg => {
    //       fs.writeFileSync(`/Volumes/External/test/${Date.now()}.jpeg`, jpeg);
    //       this.console.log('jepg!');
    //     })
    //   this.console.log('retaining media');
    // }
    return newOrBetterDetection;
  }

  async onDetection(detection: ObjectsDetected, mediaObject?: MediaObject): Promise<boolean> {
    return this.handleDetectionEvent(detection, mediaObject);
  }
  async onDetectionEnded(detection: ObjectsDetected): Promise<void> {
    this.handleDetectionEvent(detection);
  }

  async startVideoDetection() {
    try {
      // prevent stream retrieval noise until notified that the detection is no longer running.
      if (this.running) {
        const session = await this.objectDetection?.detectObjects(undefined, {
          detectionId: this.detectionId,
          duration: this.getDetectionDuration(),
          settings: await this.getCurrentSettings(),
        }, this);
        this.running = session.running;
        if (this.running)
          return;
      }

      // dummy up the last detection time to prevent the idle timers from purging everything.
      this.detectionState.lastDetection = Date.now();

      this.running = true;

      let stream: MediaObject;

      // internal streams must implicitly be available.
      if (!this.internal) {
        stream = await this.cameraDevice.getVideoStream({
          destination: 'low-resolution',
          // ask rebroadcast to mute audio, not needed.
          audio: null,
        });
      }
      else {
        stream = await mediaManager.createMediaObject(Buffer.alloc(0), 'x-scrypted/x-internal-media-object');
      }

      const session = await this.objectDetection?.detectObjects(stream, {
        detectionId: this.detectionId,
        duration: this.getDetectionDuration(),
        settings: await this.getCurrentSettings(),
      }, this);

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

  reportObjectDetections(detection: ObjectsDetected) {
    // determine zones of the objects, if configured.
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

    // if this detector supports bounding boxes, and there are zones configured,
    // filter the detections to the zones.
    if (Object.keys(this.zones).length)
      detection.detections = detection.detections.filter(o => !o.boundingBox || o?.zones?.length);

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

    if (!this.hasMotionType || this.motionAsObjects)
      this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
  }

  async extendedObjectDetect(force?: boolean) {
    try {
      if (!force && !this.motionDetected)
        return;
      await this.objectDetection?.detectObjects(undefined, {
        detectionId: this.detectionId,
        duration: this.getDetectionDuration(),
      }, this);
    }
    catch (e) {
      // ignore any
    }
  }

  objectsDetected(detectionResult: ObjectsDetected, showAll?: boolean) {
    // do not denoise
    if (this.hasMotionType) {
      return;
    }

    if (!detectionResult?.detections) {
      // detection session ended.
      return;
    }

    const { detections } = detectionResult;

    let newOrBetterDetection = false;

    const found: DenoisedDetectionEntry<TrackedDetection>[] = [];
    denoiseDetections<TrackedDetection>(this.detectionState, detections.map(detection => ({
      id: detection.id,
      name: detection.className,
      detection,
      get firstSeen() {
        return detection.history?.firstSeen
      },
      set firstSeen(value) {
        detection.history = detection.history || {
          firstSeen: value,
          lastSeen: value,
        };
        detection.history.firstSeen = value;
      },
      get lastSeen() {
        return detection.history?.lastSeen
      },
      set lastSeen(value) {
        detection.history = detection.history || {
          firstSeen: value,
          lastSeen: value,
        };
        detection.history.lastSeen = value;
      },
      boundingBox: detection.boundingBox,
    })), {
      timeout: this.detectionTimeout * 1000,
      added: d => {
        found.push(d);
        newOrBetterDetection = true;
        d.detection.bestScore = d.detection.score;
      },
      removed: d => {
        this.console.log('expired detection:', `${d.detection.className} (${d.detection.score})`);
        if (detectionResult.running)
          this.extendedObjectDetect();
      },
      retained: (d, o) => {
        if (d.detection.score > o.detection.bestScore) {
          newOrBetterDetection = true;
          d.detection.bestScore = d.detection.score;
        }
        else {
          d.detection.bestScore = o.detection.bestScore;
        }
      },
    });
    if (found.length) {
      this.console.log('new detection:', found.map(d => `${d.detection.className} (${d.detection.score})`).join(', '));
      if (detectionResult.running)
        this.extendedObjectDetect();
    }
    if (found.length || showAll) {
      this.console.log('current detections:', this.detectionState.previousDetections.map(d => `${d.detection.className} (${d.detection.score})`).join(', '));
    }

    return newOrBetterDetection;
  }

  setDetection(detection: ObjectsDetected, detectionInput: MediaObject) {
    if (!detection.detectionId)
      detection.detectionId = crypto.randomBytes(4).toString('hex');

    const { detectionId } = detection;
    this.detections.set(detectionId, detectionInput);
    setTimeout(() => {
      this.detections.delete(detectionId);
    }, 2000);
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
    if (detection)
      return detection;
    if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
      return this.mixinDevice.getDetectionInput(detectionId);
    throw new Error('Detection not found. It may have expired.');
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

    await this.ensureSettings();
    if (this.settings) {
      settings.push(...this.settings.map(setting =>
        Object.assign({}, setting, {
          placeholder: setting.placeholder?.toString(),
          value: (setting.multiple ? safeParseJson(this.storage.getItem(setting.key)) : this.storage.getItem(setting.key))
            || setting.value,
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
    let vs = value?.toString();

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

    if (value && this.settings?.find(s => s.key === key)?.multiple) {
      vs = JSON.stringify(value);
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
    else if (key === 'analyzeButton') {
      this.analyzeStarted = Date.now();
      // await this.snapshotDetection();
      await this.startVideoDetection();
      await this.extendedObjectDetect(true);
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

  async release() {
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
    super({ mixinDevice, mixinDeviceInterfaces, mixinDeviceState, mixinProviderNativeId });

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

export default ObjectDetectionPlugin;
