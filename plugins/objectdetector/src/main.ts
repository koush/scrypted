import sdk, { Camera, DeviceState, EventListenerRegister, MediaObject, MediaStreamOptions, MixinDeviceBase, MixinProvider, MotionSensor, ObjectDetection, ObjectDetectionCallbacks, ObjectDetectionModel, ObjectDetectionResult, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, ScryptedNativeId, Setting, Settings, VideoCamera } from '@scrypted/sdk';
import crypto from 'crypto';
import { AutoenableMixinProvider } from "../../../common/src/autoenable-mixin-provider";
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { DenoisedDetectionEntry, DenoisedDetectionState, denoiseDetections } from './denoise';
import { safeParseJson } from './util';

const polygonOverlap = require('polygon-overlap');
const insidePolygon = require('point-inside-polygon');

const { mediaManager, systemManager, log } = sdk;

const defaultDetectionDuration = 60;
const defaultDetectionInterval = 60;
const defaultDetectionTimeout = 60;
const defaultMotionDuration = 10;
const defaultScoreThreshold = .2;
const defaultSecondScoreThreshold = .7;

const DETECT_PERIODIC_SNAPSHOTS = "Periodic Snapshots";
const DETECT_MOTION_SNAPSHOTS = "Motion Snapshots";
const DETECT_VIDEO_MOTION = "Video Motion";

type ClipPath = [number, number][];
type Zones = { [zone: string]: ClipPath };
interface ZoneInfo {
  exclusion?: boolean;
  type?: 'Intersect' | 'Contain';
  classes?: string[];
  scoreThreshold?: number;
  secondScoreThreshold?: number;
}
type ZoneInfos = { [zone: string]: ZoneInfo };

type TrackedDetection = ObjectDetectionResult & {
  newOrBetterDetection?: boolean;
  bestScore?: number;
  bestSecondPassScore?: number;
};

class ObjectDetectionMixin extends SettingsMixinDeviceBase<VideoCamera & Camera & MotionSensor & ObjectDetector> implements ObjectDetector, Settings, ObjectDetectionCallbacks {
  released = false;
  motionListener: EventListenerRegister;
  detectorListener: EventListenerRegister;
  motionMixinListeners: EventListenerRegister[];
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
  zoneInfos = this.getZoneInfos();
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
    if (!this.hasMotionType)
      return;
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
    this.trackObjects(detections, true);
    this.reportObjectDetections(detections);
  }

  bindObjectDetection() {
    this.running = false;
    this.detectorListener?.removeListener();
    this.detectorListener = undefined;
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
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
        this.trackObjects(detections, true);
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

    this.motionMixinListeners = [...(this.mixins || []), this.id]
    .map(id => {
      return this.cameraDevice.listen({
        event: ScryptedInterface.MotionSensor,
        mixinId: id,
      }, (source, details, data) => {
        this.console.log('received suppressed motion event.');
      });
    });
  }

  async handleDetectionEvent(detection: ObjectsDetected, redetect?: (boundingBox: [number, number, number, number]) => Promise<ObjectDetectionResult[]>, mediaObject?: MediaObject) {
    this.running = detection.running;

    // track the objects on a pre-zoned set.
    this.trackObjects(detection);

    // apply the zones to the detections and get a shallow copy list of detections after
    // exclusion zones have applied
    const zonedDetections = this.applyZones(detection)
      .filter(d => {
        if (!d.zones?.length)
          return d.bestSecondPassScore >= this.secondScoreThreshold || d.score >= this.scoreThreshold;

        for (const zone of d.zones || []) {
          const zi = this.zoneInfos[zone];
          const scoreThreshold = zi?.scoreThreshold || this.scoreThreshold;
          const secondScoreThreshold = zi?.secondScoreThreshold || this.secondScoreThreshold;
          // keep the object if it passes the score check, or has already passed a second score check.
          if (d.bestSecondPassScore >= secondScoreThreshold || d.score >= scoreThreshold)
            return true;
        }
      });

    let newOrBetterDetection = false;

    if (!this.hasMotionType && redetect && this.secondScoreThreshold && detection.detections) {
      const detections = detection.detections as TrackedDetection[];
      const newOrBetterDetections = zonedDetections.filter(d => d.newOrBetterDetection);
      detections?.forEach(d => d.newOrBetterDetection = false);

      // anything with a higher pass initial score should be redetected
      // as it may yield a better second pass score and thus a better thumbnail.
      await Promise.allSettled(newOrBetterDetections.map(async d => {
        const maybeUpdateSecondPassScore = (secondPassScore: number) => {
          if (!d.bestSecondPassScore || secondPassScore > d.bestSecondPassScore) {
            newOrBetterDetection = true;
            d.bestSecondPassScore = secondPassScore;
          }
        }

        // the initial score may be sufficient.
        if (d.score >= this.secondScoreThreshold) {
          maybeUpdateSecondPassScore(d.score);
          return;
        }

        const redetected = await redetect(d.boundingBox);
        const best = redetected.filter(r => r.className === d.className).sort((a, b) => b.score - a.score)?.[0];
        if (best)
          maybeUpdateSecondPassScore(best.score)
      }));

      const secondPassDetections = zonedDetections.filter(d => d.bestSecondPassScore >= this.secondScoreThreshold)
        .map(d => ({
          ...d,
          score: d.bestSecondPassScore,
        }));
      detection.detections = secondPassDetections;
    }

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

  get scoreThreshold() {
    return parseFloat(this.storage.getItem('scoreThreshold')) || defaultScoreThreshold;
  }

  get secondScoreThreshold() {
    const r = parseFloat(this.storage.getItem('secondScoreThreshold'));
    if (isNaN(r))
      return defaultSecondScoreThreshold;
    return r;
  }

  async onDetection(detection: ObjectsDetected, redetect?: (boundingBox: [number, number, number, number]) => Promise<ObjectDetectionResult[]>, mediaObject?: MediaObject): Promise<boolean> {
    // detection.detections = detection.detections?.filter(d => d.score >= this.scoreThreshold);
    return this.handleDetectionEvent(detection, redetect, mediaObject);
  }

  async onDetectionEnded(detection: ObjectsDetected): Promise<void> {
    this.handleDetectionEvent(detection);
  }

  async startVideoDetection() {
    try {
      const settings = await this.getCurrentSettings();

      // prevent stream retrieval noise until notified that the detection is no longer running.
      if (this.running) {
        const session = await this.objectDetection?.detectObjects(undefined, {
          detectionId: this.detectionId,
          duration: this.getDetectionDuration(),
          settings,
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
          destination: !this.hasMotionType ? 'local-recorder' : 'low-resolution',
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
        settings,
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

  applyZones(detection: ObjectsDetected) {
    // determine zones of the objects, if configured.
    if (!detection.detections)
      return;
    let copy = detection.detections.slice();
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

      let included: boolean;
      for (const [zone, zoneValue] of Object.entries(this.zones)) {
        if (zoneValue.length < 3) {
          // this.console.warn(zone, 'Zone is unconfigured, skipping.');
          continue;
        }

        const zoneInfo = this.zoneInfos[zone];
        // track if there are any inclusion zones
        if (!zoneInfo?.exclusion && !included)
          included = false;

        let match = false;
        if (zoneInfo?.type === 'Contain') {
          match = insidePolygon(box[0], zoneValue) &&
            insidePolygon(box[1], zoneValue) &&
            insidePolygon(box[2], zoneValue) &&
            insidePolygon(box[3], zoneValue);
        }
        else {
          match = polygonOverlap(box, zoneValue);
        }

        if (match && zoneInfo?.classes?.length) {
          match = zoneInfo.classes.includes(o.className);
        }
        if (match) {
          o.zones.push(zone);

          if (zoneInfo?.exclusion && match) {
            copy = copy.filter(c => c !== o);
            break;
          }

          included = true;
        }
      }

      // if there are inclusion zones and this object
      // was not in any of them, filter it out.
      if (included === false)
        copy = copy.filter(c => c !== o);
    }

    return copy as TrackedDetection[];
  }

  reportObjectDetections(detection: ObjectsDetected) {
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

  trackObjects(detectionResult: ObjectsDetected, showAll?: boolean) {
    // do not denoise
    if (this.hasMotionType) {
      return;
    }

    if (!detectionResult?.detections) {
      // detection session ended.
      return;
    }

    const { detections } = detectionResult;

    const found: DenoisedDetectionEntry<TrackedDetection>[] = [];
    denoiseDetections<TrackedDetection>(this.detectionState, detections.map(detection => ({
      get id() {
        return detection.id;
      },
      set id(id) {
        detection.id = id;
      },
      name: detection.className,
      score: detection.score,
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
        d.detection.bestScore = d.detection.score;
        d.detection.newOrBetterDetection = true;
      },
      removed: d => {
        this.console.log('expired detection:', `${d.detection.className} (${d.detection.score})`);
        if (detectionResult.running)
          this.extendedObjectDetect();
      },
      retained: (d, o) => {
        if (d.detection.score > o.detection.bestScore) {
          d.detection.bestScore = d.detection.score;
          d.detection.newOrBetterDetection = true;
        }
        else {
          d.detection.bestScore = o.detection.bestScore;
        }
        d.detection.bestSecondPassScore = o.detection.bestSecondPassScore;
      },
      expiring: (d) => {
      },
    });
    if (found.length) {
      this.console.log('new detection:', found.map(d => `${d.detection.className} (${d.detection.score})`).join(', '));
      if (detectionResult.running)
        this.extendedObjectDetect();
    }
    if (found.length || showAll) {
      this.console.log('current detections:', this.detectionState.previousDetections.map(d => `${d.detection.className} (${d.detection.score}, ${d.detection.boundingBox?.join(', ')})`).join(', '));
    }

    // removes items that is not tracked yet (may require more present frames)
    detectionResult.detections = detectionResult.detections.filter(d => d.id);
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
      let hasInclusionZone = false;
      for (const zone of Object.keys(this.zones)) {
        const zi = this.zoneInfos[zone];
        if (!zi?.exclusion) {
          hasInclusionZone = true;
          break;
        }
      }
      if (!hasInclusionZone) {
        settings.push(
          {
            title: 'Minimum Detection Confidence',
            description: 'Higher values eliminate false positives and low quality recognition candidates.',
            key: 'scoreThreshold',
            type: 'number',
            value: this.scoreThreshold,
            placeholder: '.2',
          },
          {
            title: 'Second Pass Confidence',
            description: 'Crop and reanalyze a result from the initial detection pass to get more accurate results.',
            key: 'secondScoreThreshold',
            type: 'number',
            value: this.secondScoreThreshold,
            placeholder: '.7',
          },
        );
      }

      settings.push(
        {
          title: 'Analyze',
          description: 'Analyzes the video stream for 1 minute. Results will be shown in the Console.',
          key: 'analyzeButton',
          type: 'button',
        },
      );
    }

    settings.push({
      key: 'zones',
      title: 'Zones',
      type: 'string',
      description: 'Enter the name of a new zone or delete an existing zone.',
      multiple: true,
      value: Object.keys(this.zones),
      choices: Object.keys(this.zones),
      combobox: true,
    });

    for (const [name, value] of Object.entries(this.zones)) {
      const zi = this.zoneInfos[name];

      const subgroup = `Zone: ${name}`;
      settings.push({
        subgroup,
        key: `zone-${name}`,
        title: `Edit Zone`,
        type: 'clippath',
        value: JSON.stringify(value),
      });

      settings.push({
        subgroup,
        key: `zoneinfo-exclusion-${name}`,
        title: `Exclusion Zone`,
        description: 'Detections in this zone will be excluded.',
        type: 'boolean',
        value: zi?.exclusion,
      });

      settings.push({
        subgroup,
        key: `zoneinfo-type-${name}`,
        title: `Zone Type`,
        description: 'An Intersect zone will match objects that are partially or fully inside the zone. A Contain zone will only match objects that are fully inside the zone.',
        choices: [
          'Intersect',
          'Contain',
        ],
        value: zi?.type || 'Intersect',
      });

      if (!this.hasMotionType) {
        settings.push(
          {
            subgroup,
            key: `zoneinfo-classes-${name}`,
            title: `Detection Classes`,
            description: 'The detection classes to match inside this zone. An empty list will match all classes.',
            choices: (await this.getObjectTypes())?.classes || [],
            value: zi?.classes || [],
            multiple: true,
          },
          {
            subgroup,
            title: 'Minimum Detection Confidence',
            description: 'Higher values eliminate false positives and low quality recognition candidates.',
            key: `zoneinfo-scoreThreshold-${name}`,
            type: 'number',
            value: zi?.scoreThreshold || this.scoreThreshold,
            placeholder: '.2',
          },
          {
            subgroup,
            title: 'Second Pass Confidence',
            description: 'Crop and reanalyze a result from the initial detection pass to get more accurate results.',
            key: `zoneinfo-secondScoreThreshold-${name}`,
            type: 'number',
            value: zi?.secondScoreThreshold || this.secondScoreThreshold,
            placeholder: '.7',
          },
        );
      }
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

  getZoneInfos(): ZoneInfos {
    try {
      return JSON.parse(this.storage.getItem('zoneInfos'));
    }
    catch (e) {
      return {};
    }
  }

  async putMixinSetting(key: string, value: string | number | boolean | string[] | number[]): Promise<void> {
    let vs = value?.toString();

    if (key === 'zones') {
      const newZones: Zones = {};
      const newZoneInfos: ZoneInfos = {};
      for (const name of value as string[]) {
        newZones[name] = this.zones[name] || [];
        newZoneInfos[name] = this.zoneInfos[name];
      }
      this.zones = newZones;
      this.zoneInfos = newZoneInfos;
      this.storage.setItem('zones', JSON.stringify(newZones));
      this.storage.setItem('zoneInfos', JSON.stringify(newZoneInfos));
      return;
    }
    if (key.startsWith('zone-')) {
      const zoneName = key.substring('zone-'.length);
      if (this.zones[zoneName]) {
        this.zones[zoneName] = JSON.parse(vs);
        this.storage.setItem('zones', JSON.stringify(this.zones));
      }
      return;
    }
    if (key.startsWith('zoneinfo-')) {
      const [zkey, zoneName] = key.substring('zoneinfo-'.length).split('-');
      this.zoneInfos[zoneName] ||= {};
      this.zoneInfos[zoneName][zkey] = value;
      this.storage.setItem('zoneInfos', JSON.stringify(this.zoneInfos));
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
    this.motionMixinListeners?.forEach(l => l.removeListener());
    this.motionMixinListeners = undefined;
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
      const ret = [ScryptedInterface.ObjectDetector, ScryptedInterface.Settings];
      const model = await this.mixinDevice.getDetectionModel();
      if (model.classes?.includes('motion'))
        ret.push(ScryptedInterface.MotionSensor)
      return ret;

    }
    return null;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    let objectDetection = systemManager.getDeviceById<ObjectDetection>(this.id);
    const group = objectDetection.name.replace('Plugin', '').trim();
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
