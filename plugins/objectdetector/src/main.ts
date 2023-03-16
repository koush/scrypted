import sdk, { ScryptedMimeTypes, Image, VideoFrame, VideoFrameGenerator, Camera, DeviceState, EventListenerRegister, MediaObject, MixinDeviceBase, MixinProvider, MotionSensor, ObjectDetection, ObjectDetectionCallbacks, ObjectDetectionModel, ObjectDetectionResult, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import cloneDeep from 'lodash/cloneDeep';
import { AutoenableMixinProvider } from "../../../common/src/autoenable-mixin-provider";
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { DenoisedDetectionEntry, DenoisedDetectionState, denoiseDetections } from './denoise';
import { serverSupportsMixinEventMasking } from './server-version';
import { sleep } from './sleep';
import { getAllDevices, safeParseJson } from './util';

const polygonOverlap = require('polygon-overlap');
const insidePolygon = require('point-inside-polygon');

const { systemManager } = sdk;

const defaultDetectionDuration = 20;
const defaultDetectionInterval = 60;
const defaultDetectionTimeout = 60;
const defaultMotionDuration = 10;
const defaultScoreThreshold = .2;
const defaultSecondScoreThreshold = .7;

const BUILTIN_MOTION_SENSOR_ASSIST = 'Assist';
const BUILTIN_MOTION_SENSOR_REPLACE = 'Replace';

const objectDetectionPrefix = `${ScryptedInterface.ObjectDetection}:`;

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
  motionListener: EventListenerRegister;
  detectorListener: EventListenerRegister;
  motionMixinListener: EventListenerRegister;
  detections = new Map<string, MediaObject>();
  cameraDevice: ScryptedDevice & Camera & VideoCamera & MotionSensor & ObjectDetector;
  storageSettings = new StorageSettings(this, {
    newPipeline: {
      title: 'Video Pipeline',
      description: 'Configure how frames are provided to the video analysis pipeline.',
      choices: [
        'Default',
        'Snapshot',
        ...getAllDevices().filter(d => d.interfaces.includes(ScryptedInterface.VideoFrameGenerator)).map(d => d.name),
      ],
      defaultValue: 'Default',
    },
    motionSensorSupplementation: {
      title: 'Built-In Motion Sensor',
      description: `This camera has a built in motion sensor. Using ${this.objectDetection.name} may be unnecessary and will use additional CPU. Replace will ignore the built in motion sensor. Filter will verify the motion sent by built in motion sensor. The Default is ${BUILTIN_MOTION_SENSOR_REPLACE}.`,
      choices: [
        'Default',
        BUILTIN_MOTION_SENSOR_ASSIST,
        BUILTIN_MOTION_SENSOR_REPLACE,
      ],
      defaultValue: "Default",
    },
    captureMode: {
      title: 'Capture Mode',
      description: 'The method to capture frames for analysis. Video will require more processing power.',
      choices: [
        'Default',
        'Video',
        'Snapshot',
      ],
      defaultValue: 'Default',
    },
    detectionDuration: {
      title: 'Detection Duration',
      subgroup: 'Advanced',
      description: 'The duration in seconds to analyze video when motion occurs.',
      type: 'number',
      defaultValue: defaultDetectionDuration,
    },
    detectionTimeout: {
      title: 'Detection Timeout',
      subgroup: 'Advanced',
      description: 'Timeout in seconds before removing an object that is no longer detected.',
      type: 'number',
      defaultValue: defaultDetectionTimeout,
    },
    motionDuration: {
      title: 'Motion Duration',
      description: 'The duration in seconds to wait to reset the motion sensor.',
      type: 'number',
      defaultValue: defaultMotionDuration,
    },
    motionAsObjects: {
      title: 'Motion Detection Objects',
      description: 'Report motion detections as objects (useful for debugging).',
      type: 'boolean',
    },
    detectionInterval: {
      type: 'number',
      defaultValue: defaultDetectionInterval,
      hide: true,
    },
    scoreThreshold: {
      title: 'Minimum Detection Confidence',
      subgroup: 'Advanced',
      description: 'Higher values eliminate false positives and low quality recognition candidates.',
      type: 'number',
      placeholder: '.2',
      defaultValue: defaultScoreThreshold,
    },
    secondScoreThreshold: {
      title: 'Second Pass Confidence',
      subgroup: 'Advanced',
      description: 'Crop and reanalyze a result from the initial detection pass to get more accurate results.',
      key: 'secondScoreThreshold',
      type: 'number',
      defaultValue: defaultSecondScoreThreshold,
      placeholder: '.7',
    },
  });
  motionTimeout: NodeJS.Timeout;
  zones = this.getZones();
  zoneInfos = this.getZoneInfos();
  detectionIntervalTimeout: NodeJS.Timeout;
  detectionState: DenoisedDetectionState<TrackedDetection> = {};
  detectionId: string;
  detectorRunning = false;
  analyzeStop = 0;
  lastDetectionInput = 0;

  constructor(public plugin: ObjectDetectionPlugin, mixinDevice: VideoCamera & Camera & MotionSensor & ObjectDetector & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string, public objectDetection: ObjectDetection & ScryptedDevice, modelName: string, group: string, public hasMotionType: boolean, public settings: Setting[]) {
    super({
      mixinDevice, mixinDeviceState,
      mixinProviderNativeId: providerNativeId,
      mixinDeviceInterfaces,
      group,
      groupKey: "objectdetectionplugin:" + objectDetection.id,
      mixinStorageSuffix: objectDetection.id,
    });

    this.cameraDevice = systemManager.getDeviceById<Camera & VideoCamera & MotionSensor & ObjectDetector>(this.id);
    this.detectionId = modelName + '-' + this.cameraDevice.id;

    this.bindObjectDetection();
    this.register();
    this.resetDetectionTimeout();
  }

  clearDetectionTimeout() {
    clearTimeout(this.detectionIntervalTimeout);
    this.detectionIntervalTimeout = undefined;
  }

  resetDetectionTimeout() {
    this.clearDetectionTimeout();
    this.detectionIntervalTimeout = setInterval(async () => {
      if (this.hasMotionType) {
        // force a motion detection restart if it quit
        if (this.motionSensorSupplementation === BUILTIN_MOTION_SENSOR_REPLACE)
          await this.startVideoDetection();
        return;
      }
    }, this.storageSettings.values.detectionInterval * 1000);
  }

  clearMotionTimeout() {
    clearTimeout(this.motionTimeout);
    this.motionTimeout = undefined;
  }

  resetMotionTimeout() {
    this.clearMotionTimeout();
    this.motionTimeout = setTimeout(() => {
      this.motionDetected = false;
      // if (this.motionSensorSupplementation === BUILTIN_MOTION_SENSOR_ASSIST) {
      //   this.console.log(`${this.objectDetection.name} timed out confirming motion, stopping video detection.`)
      //   this.endObjectDetection();
      // }
    }, this.storageSettings.values.motionDuration * 1000);
  }

  getCurrentSettings() {
    if (!this.settings)
      return;

    const ret: { [key: string]: any } = {};
    for (const setting of this.settings) {
      ret[setting.key] = (setting.multiple ? safeParseJson(this.storage.getItem(setting.key)) : this.storage.getItem(setting.key))
        || setting.value;
    }

    if (this.hasMotionType)
      ret['motionAsObjects'] = this.storageSettings.values.motionAsObjects;

    return ret;
  }

  async snapshotDetection() {
    const picture = await this.cameraDevice.takePicture();
    let detections = await this.objectDetection.detectObjects(picture, {
      detectionId: this.detectionId,
      settings: this.getCurrentSettings(),
    });
    detections = await this.trackObjects(detections, true);
    this.reportObjectDetections(detections);
  }

  async maybeStartMotionDetection() {
    if (!this.hasMotionType)
      return;
    if (this.motionSensorSupplementation !== BUILTIN_MOTION_SENSOR_REPLACE)
      return;
    await this.startVideoDetection();
  }

  endObjectDetection() {
    this.detectorRunning = false;
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
      settings: this.getCurrentSettings(),
    });
  }

  bindObjectDetection() {
    if (this.hasMotionType)
      this.motionDetected = false;

    this.detectorRunning = false;
    this.detectorListener?.removeListener();
    this.detectorListener = undefined;
    this.endObjectDetection();

    this.maybeStartMotionDetection();
  }
  async register() {
    const model = await this.objectDetection.getDetectionModel();

    if (!this.hasMotionType) {
      if (model.triggerClasses?.includes('motion')) {
        this.motionListener = this.cameraDevice.listen(ScryptedInterface.MotionSensor, async () => {
          if (!this.cameraDevice.motionDetected) {
            if (this.detectorRunning) {
              // allow anaysis due to user request.
              if (this.analyzeStop > Date.now())
                return;

              this.console.log('motion stopped, cancelling ongoing detection')
              this.endObjectDetection();
            }
            return;
          }

          await this.startStreamAnalysis();
        });
      }

      const nonMotion = model.triggerClasses?.find(t => t !== 'motion');
      if (nonMotion) {
        this.detectorListener = this.cameraDevice.listen(ScryptedInterface.ObjectDetector, async (s, d, data: ObjectsDetected) => {
          if (!model.triggerClasses)
            return;
          if (!data.detectionId)
            return;
          const { detections } = data;
          if (!detections?.length)
            return;

          const set = new Set(detections.map(d => d.className));
          for (const trigger of model.triggerClasses) {
            if (trigger === 'motion')
              continue;

            if (set.has(trigger)) {
              const jpeg = await this.cameraDevice.getDetectionInput(data.detectionId, data.eventId);
              const found = await this.objectDetection.detectObjects(jpeg);
              found.detectionId = data.detectionId;
              this.handleDetectionEvent(found, undefined, jpeg);
              return;
            }
          }
        });
      }

      return;
    }

    if (this.hasMotionType) {
      this.motionMixinListener = this.cameraDevice.listen({
        event: ScryptedInterface.MotionSensor,
        mixinId: this.id,
      }, async (source, details, data) => {
        if (this.motionSensorSupplementation !== BUILTIN_MOTION_SENSOR_ASSIST)
          return;
        if (data) {
          if (this.motionDetected)
            return;
          if (!this.detectorRunning)
            this.console.log('built in motion sensor started motion, starting video detection.');
          await this.startVideoDetection();
          return;
        }

        this.clearMotionTimeout();
        if (this.detectorRunning) {
          this.console.log('built in motion sensor ended motion, stopping video detection.')
          this.endObjectDetection();
        }
        if (this.motionDetected)
          this.motionDetected = false;
      });
    }
  }

  async handleDetectionEvent(detection: ObjectsDetected, redetect?: (boundingBox: [number, number, number, number]) => Promise<ObjectDetectionResult[]>, mediaObject?: MediaObject) {
    this.detectorRunning = detection.running;

    detection = await this.trackObjects(detection);

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

    let retainImage = false;

    if (!this.hasMotionType && redetect && this.secondScoreThreshold && detection.detections) {
      const detections = detection.detections as TrackedDetection[];
      const newOrBetterDetections = zonedDetections.filter(d => d.newOrBetterDetection);
      detections?.forEach(d => d.newOrBetterDetection = false);

      // anything with a higher pass initial score should be redetected
      // as it may yield a better second pass score and thus a better thumbnail.
      await Promise.allSettled(newOrBetterDetections.map(async d => {
        const maybeUpdateSecondPassScore = (secondPassScore: number) => {
          let better = false;
          // initialize second pass result
          if (!d.bestSecondPassScore) {
            better = true;
            d.bestSecondPassScore = 0;
          }
          // retain passing the second pass threshold for first time.
          if (d.bestSecondPassScore < this.secondScoreThreshold && secondPassScore >= this.secondScoreThreshold) {
            this.console.log('improved', d.id, secondPassScore, d.score);
            better = true;
            retainImage = true;
          }
          else if (secondPassScore > d.bestSecondPassScore * 1.1) {
            this.console.log('improved', d.id, secondPassScore, d.score);
            better = true;
            retainImage = true;
          }
          if (better)
            d.bestSecondPassScore = secondPassScore;
          return better;
        }

        // the initial score may be sufficient.
        if (d.score >= this.secondScoreThreshold) {
          maybeUpdateSecondPassScore(d.score);
          return;
        }

        const redetected = await redetect(d.boundingBox);
        const best = redetected.filter(r => r.className === d.className).sort((a, b) => b.score - a.score)?.[0];
        if (best) {
          if (maybeUpdateSecondPassScore(best.score)) {
            d.boundingBox = best.boundingBox;
          }
        }
      }));

      const secondPassDetections = zonedDetections.filter(d => d.bestSecondPassScore >= this.secondScoreThreshold)
        .map(d => ({
          ...d,
          score: d.bestSecondPassScore,
        }));
      detection.detections = secondPassDetections;
    }
    else {
      detection.detections = zonedDetections;
    }

    if (detection.detections) {
      const trackedDetections = cloneDeep(detection.detections) as TrackedDetection[];
      for (const d of trackedDetections) {
        delete d.bestScore;
        delete d.bestSecondPassScore;
        delete d.newOrBetterDetection;
      }
      detection.detections = trackedDetections;
    }

    const now = Date.now();
    if (this.lastDetectionInput + this.storageSettings.values.detectionTimeout * 1000 < Date.now())
      retainImage = true;

    if (retainImage && mediaObject) {
      this.lastDetectionInput = now;
      this.console.log('retaining detection image');
      this.setDetection(detection, mediaObject);
    }

    this.reportObjectDetections(detection);
    return retainImage;
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

  async startSnapshotAnalysis() {
    if (this.detectorRunning)
      return;

    this.detectorRunning = true;
    this.analyzeStop = Date.now() + this.getDetectionDuration();

    while (this.detectorRunning) {
      const now = Date.now();
      if (now > this.analyzeStop)
        break;
      try {
        const mo = await this.mixinDevice.takePicture({
          reason: 'event',
        });
        const found = await this.objectDetection.detectObjects(mo, {
          detectionId: this.detectionId,
          duration: this.getDetectionDuration(),
          settings: this.getCurrentSettings(),
        }, this);
      }
      catch (e) {
        this.console.error('snapshot detection error', e);
      }
      // cameras tend to only refresh every 1s at best.
      // maybe get this value from somewhere? or sha the jpeg?
      const diff = now + 1100 - Date.now();
      if (diff > 0)
        await sleep(diff);
    }
    this.endObjectDetection();
  }

  async startPipelineAnalysis() {
    if (this.detectorRunning)
      return;

    this.detectorRunning = true;
    this.analyzeStop = Date.now() + this.getDetectionDuration();

    const newPipeline = this.newPipeline;
    let generator: AsyncGenerator<VideoFrame & MediaObject>;
    if (newPipeline === 'Snapshot') {
      const self = this;
      generator = (async function* gen() {
        while (true) {
          const now = Date.now();
          const sleeper = async () => {
            const diff = now + 1100 - Date.now();
            if (diff > 0)
              await sleep(diff);
          };
          let image: MediaObject & VideoFrame;
          try {
            const mo = await self.cameraDevice.takePicture({
              reason: 'event',
            });
            image = await sdk.mediaManager.convertMediaObject(mo, ScryptedMimeTypes.Image);
          }
          catch (e) {
            self.console.error('Video analysis snapshot failed. Will retry in a moment.');
            await sleeper();
            continue;
          }

          yield image;
          await sleeper();
        }
      })();
    }
    else {
      const videoFrameGenerator = systemManager.getDeviceById<VideoFrameGenerator>(newPipeline);
      if (!videoFrameGenerator)
        throw new Error('invalid VideoFrameGenerator');
      const stream = await this.cameraDevice.getVideoStream({
        destination: 'local-recorder',
        // ask rebroadcast to mute audio, not needed.
        audio: null,
      });

      generator = await videoFrameGenerator.generateVideoFrames(stream);
    }

    try {
      const start = Date.now();
      let detections = 0;
      for await (const detected
        of await this.objectDetection.generateObjectDetections(generator, {
          settings: this.getCurrentSettings(),
        })) {
        if (!this.detectorRunning) {
          break;
        }
        const now = Date.now();
        if (now > this.analyzeStop) {
          break;
        }

        // apply the zones to the detections and get a shallow copy list of detections after
        // exclusion zones have applied
        const zonedDetections = this.applyZones(detected.detected);
        const filteredDetections = zonedDetections
          .filter(d => {
            if (!d.zones?.length)
              return d.score >= this.scoreThreshold;

            for (const zone of d.zones || []) {
              const zi = this.zoneInfos[zone];
              const scoreThreshold = zi?.scoreThreshold || this.scoreThreshold;
              if (d.score >= scoreThreshold)
                return true;
            }
          });

        detected.detected.detections = filteredDetections;

        detections++;
        // this.console.warn('dps', detections / (Date.now() - start) * 1000);

        if (detected.detected.detectionId) {
          const jpeg = await detected.videoFrame.toBuffer({
            format: 'jpg',
          });
          const mo = await sdk.mediaManager.createMediaObject(jpeg, 'image/jpeg');
          this.setDetection(detected.detected, mo);
          // this.console.log('image saved', detected.detected.detections);
        }
        this.reportObjectDetections(detected.detected);
        // this.handleDetectionEvent(detected.detected);
      }
    }
    finally {
      this.endObjectDetection();
    }
  }

  async startStreamAnalysis() {
    if (this.newPipeline) {
      await this.startPipelineAnalysis();
    }
    else if (!this.hasMotionType && this.storageSettings.values.captureMode === 'Snapshot') {
      await this.startSnapshotAnalysis();
    }
    else {
      await this.startVideoDetection();
    }
  }

  async extendedObjectDetect(force?: boolean) {
    if (!this.hasMotionType && this.storageSettings.values.captureMode === 'Snapshot') {
      this.analyzeStop = Date.now() + this.getDetectionDuration();
    }
    else {
      try {
        if (!force && !this.motionDetected)
          return;
        await this.objectDetection?.detectObjects(undefined, {
          detectionId: this.detectionId,
          duration: this.getDetectionDuration(),
          settings: this.getCurrentSettings(),
        }, this);
      }
      catch (e) {
        // ignore any
      }
    }
  }

  async startVideoDetection() {
    try {
      const settings = this.getCurrentSettings();

      // prevent stream retrieval noise until notified that the detection is no longer running.
      if (this.detectorRunning) {
        const session = await this.objectDetection?.detectObjects(undefined, {
          detectionId: this.detectionId,
          duration: this.getDetectionDuration(),
          settings,
        }, this);
        this.detectorRunning = session.running;
        if (this.detectorRunning)
          return;
      }

      // dummy up the last detection time to prevent the idle timers from purging everything.
      this.detectionState.lastDetection = Date.now();

      this.detectorRunning = true;
      let stream: MediaObject;

      stream = await this.cameraDevice.getVideoStream({
        destination: !this.hasMotionType ? 'local-recorder' : 'low-resolution',
        // ask rebroadcast to mute audio, not needed.
        audio: null,
      });
      const session = await this.objectDetection?.detectObjects(stream, {
        detectionId: this.detectionId,
        duration: this.getDetectionDuration(),
        settings,
      }, this);

      this.detectorRunning = session.running;
    }
    catch (e) {
      this.console.log('failure retrieving stream', e);
      this.detectorRunning = false;
    }
  }

  getDetectionDuration() {
    // when motion type, the detection interval is a keepalive reset.
    // the duration needs to simply be an arbitrarily longer time.
    return this.hasMotionType ? this.storageSettings.values.detectionInterval * 1000 * 5 : this.storageSettings.values.detectionDuration * 1000;
  }

  applyZones(detection: ObjectsDetected) {
    // determine zones of the objects, if configured.
    if (!detection.detections)
      return [];
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

        // if (this.motionSensorSupplementation === BUILTIN_MOTION_SENSOR_ASSIST) {
        //   if (!this.motionDetected) {
        //     this.motionDetected = true;
        //     this.console.log(`${this.objectDetection.name} confirmed motion, stopping video detection.`)
        //     this.endObjectDetection();
        //     this.clearMotionTimeout();
        //   }
        // }
        // else {
        //   if (!this.motionDetected)
        //     this.motionDetected = true;
        //   this.resetMotionTimeout();
        // }

        const areas = detection.detections.filter(d => d.className === 'motion' && d.score !== 1).map(d => d.score)
        if (areas.length)
          this.console.log('detection areas', areas);
      }
    }

    if (!this.hasMotionType || this.storageSettings.values.motionAsObjects)
      this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
  }

  async trackObjects(detectionResult: ObjectsDetected, showAll?: boolean) {
    // do not denoise
    if (this.hasMotionType) {
      return detectionResult;
    }

    if (!detectionResult?.detections) {
      // detection session ended.
      return detectionResult;
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
      timeout: this.storageSettings.values.detectionTimeout * 1000,
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
      this.console.log('new detection:', found.map(d => `${d.id} ${d.detection.className} (${d.detection.score})`).join(', '));
      if (detectionResult.running)
        this.extendedObjectDetect();
    }
    if (found.length || showAll) {
      this.console.log('current detections:', this.detectionState.previousDetections.map(d => `${d.detection.className} (${d.detection.score}, ${d.detection.boundingBox?.join(', ')})`).join(', '));
    }

    return detectionResult;
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

  get motionSensorSupplementation() {
    if (!serverSupportsMixinEventMasking() || !this.interfaces.includes(ScryptedInterface.MotionSensor))
      return BUILTIN_MOTION_SENSOR_REPLACE;

    const supp = this.storage.getItem('motionSensorSupplementation');
    switch (supp) {
      case BUILTIN_MOTION_SENSOR_REPLACE:
        return BUILTIN_MOTION_SENSOR_REPLACE;
      case BUILTIN_MOTION_SENSOR_ASSIST:
        return BUILTIN_MOTION_SENSOR_ASSIST;
    }

    // if (this.mixinDeviceInterfaces?.includes(ScryptedInterface.MotionSensor))
    //   return BUILTIN_MOTION_SENSOR_ASSIST;
    return BUILTIN_MOTION_SENSOR_REPLACE;
  }

  get newPipeline() {
    if (!this.plugin.storageSettings.values.newPipeline)
      return;

    const newPipeline = this.storageSettings.values.newPipeline;
    if (!newPipeline)
      return newPipeline;
    if (newPipeline === 'Snapshot')
      return newPipeline;
    const pipelines = getAllDevices().filter(d => d.interfaces.includes(ScryptedInterface.VideoFrameGenerator));
    const found = pipelines.find(p => p.name === newPipeline);
    return found?.id || pipelines[0]?.id;
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    try {
      this.settings = (await this.objectDetection.getDetectionModel(this.getCurrentSettings())).settings;
    }
    catch (e) {
    }

    if (this.settings) {
      settings.push(...this.settings.map(setting =>
        Object.assign({}, setting, {
          placeholder: setting.placeholder?.toString(),
          value: (setting.multiple ? safeParseJson(this.storage.getItem(setting.key)) : this.storage.getItem(setting.key))
            || setting.value,
        } as Setting))
      );
    }

    this.storageSettings.settings.motionSensorSupplementation.hide = !this.hasMotionType || !this.mixinDeviceInterfaces.includes(ScryptedInterface.MotionSensor);
    this.storageSettings.settings.captureMode.hide = this.hasMotionType || !!this.plugin.storageSettings.values.newPipeline;
    this.storageSettings.settings.newPipeline.hide = this.hasMotionType || !this.plugin.storageSettings.values.newPipeline;
    this.storageSettings.settings.detectionDuration.hide = this.hasMotionType;
    this.storageSettings.settings.detectionTimeout.hide = this.hasMotionType;
    this.storageSettings.settings.motionDuration.hide = !this.hasMotionType;
    this.storageSettings.settings.motionAsObjects.hide = !this.hasMotionType;

    settings.push(...await this.storageSettings.getSettings());

    let hideThreshold = true;
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
        hideThreshold = false;
      }
    }
    this.storageSettings.settings.scoreThreshold.hide = hideThreshold;
    this.storageSettings.settings.secondScoreThreshold.hide = hideThreshold;

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
        title: `Open Zone Editor`,
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

    if (!this.hasMotionType) {
      settings.push(
        {
          title: 'Analyze',
          description: 'Analyzes the video stream for 1 minute. Results will be shown in the Console.',
          key: 'analyzeButton',
          type: 'button',
        },
      );
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

    if (this.storageSettings.settings[key]) {
      return this.storageSettings.putSetting(key, value);
    }

    if (value && this.settings?.find(s => s.key === key)?.multiple) {
      vs = JSON.stringify(value);
    }

    if (key === 'analyzeButton') {
      this.analyzeStop = Date.now() + 60000;
      // await this.snapshotDetection();
      await this.startStreamAnalysis();
    }
    else {
      const settings = this.getCurrentSettings();
      if (settings && settings[key]) {
        this.storage.setItem(key, vs);
        settings[key] = value;
      }
      this.bindObjectDetection();
    }
  }

  async release() {
    super.release();
    this.clearDetectionTimeout();
    this.clearMotionTimeout();
    this.motionListener?.removeListener();
    this.motionMixinListener?.removeListener();
    this.detectorListener?.removeListener();
    this.endObjectDetection();
  }
}

class ObjectDetectorMixin extends MixinDeviceBase<ObjectDetection> implements MixinProvider {
  currentMixins = new Set<ObjectDetectionMixin>();

  constructor(mixinDevice: ObjectDetection, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState, public plugin: ObjectDetectionPlugin, public model: ObjectDetectionModel) {
    super({ mixinDevice, mixinDeviceInterfaces, mixinDeviceState, mixinProviderNativeId: plugin.nativeId });

    // trigger mixin creation. todo: fix this to not be stupid hack.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera & Settings>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.probe();
    }
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    const hasMotionType = this.model.classes.includes('motion');
    const prefix = `${objectDetectionPrefix}${hasMotionType}`;
    const thisPrefix = `${prefix}:${this.id}`;

    const found = interfaces.find(iface => iface.startsWith(prefix) && iface !== thisPrefix);
    if (found)
      return;
    // this.console.log('found', found);

    if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) && (interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.Camera))) {
      const ret: string[] = [
        ScryptedInterface.ObjectDetector,
        ScryptedInterface.Settings,
        thisPrefix,
      ];
      const model = await this.mixinDevice.getDetectionModel();

      if (model.classes?.includes('motion')) {
        ret.push(
          ScryptedInterface.MotionSensor,
        );
      }

      return ret;
    }
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    let objectDetection = systemManager.getDeviceById<ObjectDetection>(this.id);
    const hasMotionType = this.model.classes.includes('motion');
    const group = hasMotionType ? 'Motion Detection' : 'Object Detection';
    // const group = objectDetection.name.replace('Plugin', '').trim();

    const settings = this.model.settings;

    const ret = new ObjectDetectionMixin(this.plugin, mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.mixinProviderNativeId, objectDetection, this.model.name, group, hasMotionType, settings);
    this.currentMixins.add(ret);
    return ret;
  }

  async releaseMixin(id: string, mixinDevice: any) {
    this.currentMixins.delete(mixinDevice);
    return mixinDevice.release();
  }
}

class ObjectDetectionPlugin extends AutoenableMixinProvider implements Settings {
  currentMixins = new Set<ObjectDetectorMixin>();

  storageSettings = new StorageSettings(this, {
    newPipeline: {
      title: 'New Video Pipeline',
      description: 'WARNING! DO NOT ENABLE: Use the new video pipeline. Leave blank to use the legacy pipeline.',
      type: 'boolean',
    },
    activeMotionDetections: {
      title: 'Active Motion Detection Sessions',
      readonly: true,
      mapGet: () => {
        return [...this.currentMixins.values()]
          .reduce((c1, v1) => c1 + [...v1.currentMixins.values()]
            .reduce((c2, v2) => c2 + (v2.hasMotionType && v2.detectorRunning ? 1 : 0), 0), 0);
      }
    },
    activeObjectDetections: {
      title: 'Active Object Detection Sessions',
      readonly: true,
      mapGet: () => {
        return [...this.currentMixins.values()]
          .reduce((c1, v1) => c1 + [...v1.currentMixins.values()]
            .reduce((c2, v2) => c2 + (!v2.hasMotionType && v2.detectorRunning ? 1 : 0), 0), 0);
      }
    }
  })

  constructor(nativeId?: ScryptedNativeId) {
    super(nativeId);
  }

  getSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }

  putSetting(key: string, value: SettingValue): Promise<void> {
    return this.storageSettings.putSetting(key, value);
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.ObjectDetection))
      return;
    return [ScryptedInterface.MixinProvider];
  }

  async getMixin(mixinDevice: ObjectDetection, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
    const model = await mixinDevice.getDetectionModel();
    const ret = new ObjectDetectorMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this, model);
    this.currentMixins.add(ret);
    return ret;
  }

  async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    // what does this mean to make a mixin provider no longer available?
    // just ignore it until reboot?
    this.currentMixins.delete(mixinDevice);
  }
}

export default ObjectDetectionPlugin;
