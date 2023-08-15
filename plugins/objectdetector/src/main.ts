import { Deferred } from '@scrypted/common/src/deferred';
import { sleep } from '@scrypted/common/src/sleep';
import sdk, { Camera, DeviceProvider, DeviceState, EventListenerRegister, Image, MediaObject, MediaStreamDestination, MixinDeviceBase, MixinProvider, MotionSensor, ObjectDetection, ObjectDetectionModel, ObjectDetectionTypes, ObjectDetectionZone, ObjectDetector, ObjectsDetected, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, ScryptedNativeId, Setting, Settings, SettingValue, VideoCamera, VideoFrame, VideoFrameGenerator } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import os from 'os';
import { AutoenableMixinProvider } from "../../../common/src/autoenable-mixin-provider";
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFmpegVideoFrameGenerator } from './ffmpeg-videoframes-no-sharp';
import { getMaxConcurrentObjectDetectionSessions } from './performance-profile';
import { serverSupportsMixinEventMasking } from './server-version';
import { getAllDevices, safeParseJson } from './util';

const polygonOverlap = require('polygon-overlap');
const insidePolygon = require('point-inside-polygon');

const { systemManager } = sdk;

const defaultDetectionDuration = 20;
const defaultMotionDuration = 30;

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

class ObjectDetectionMixin extends SettingsMixinDeviceBase<VideoCamera & Camera & MotionSensor & ObjectDetector> implements ObjectDetector, Settings {
  motionListener: EventListenerRegister;
  motionMixinListener: EventListenerRegister;
  detections = new Map<string, MediaObject>();
  cameraDevice: ScryptedDevice & Camera & VideoCamera & MotionSensor & ObjectDetector;
  storageSettings = new StorageSettings(this, {
    newPipeline: {
      title: 'Video Pipeline',
      description: 'Configure how frames are provided to the video analysis pipeline.',
      onGet: async () => {
        const choices = [
          'Default',
          ...getAllDevices().filter(d => d.interfaces.includes(ScryptedInterface.VideoFrameGenerator)).map(d => d.name),
        ];
        if (!this.hasMotionType)
          choices.push('Snapshot');
        return {
          choices,
        }
      },
      onPut: () => {
        this.endObjectDetection();
        this.maybeStartDetection();
      },
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
      onPut: () => {
        this.endObjectDetection();
        this.maybeStartDetection();
      }
    },
    detectionDurationDEPRECATED: {
      hide: true,
      title: 'Detection Duration',
      subgroup: 'Advanced',
      description: 'The duration in seconds to analyze video when motion occurs.',
      type: 'number',
      defaultValue: defaultDetectionDuration,
    },
    motionDuration: {
      title: 'Motion Duration',
      description: 'The duration in seconds to wait to reset the motion sensor.',
      type: 'number',
      defaultValue: defaultMotionDuration,
    },
  });
  motionTimeout: NodeJS.Timeout;
  detectionIntervalTimeout: NodeJS.Timeout;
  zones = this.getZones();
  zoneInfos = this.getZoneInfos();
  detectionStartTime: number;
  analyzeStop: number;
  detectorSignal = new Deferred<void>().resolve();
  released = false;

  get detectorRunning() {
    return !this.detectorSignal.finished;
  }

  constructor(public plugin: ObjectDetectionPlugin, mixinDevice: VideoCamera & Camera & MotionSensor & ObjectDetector & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string, public objectDetection: ObjectDetection & ScryptedDevice, public model: ObjectDetectionModel, group: string, public hasMotionType: boolean, public settings: Setting[]) {
    super({
      mixinDevice, mixinDeviceState,
      mixinProviderNativeId: providerNativeId,
      mixinDeviceInterfaces,
      group,
      groupKey: "objectdetectionplugin:" + objectDetection.id,
      mixinStorageSuffix: objectDetection.id,
    });

    this.cameraDevice = systemManager.getDeviceById<Camera & VideoCamera & MotionSensor & ObjectDetector>(this.id);

    this.bindObjectDetection();
    this.register();

    this.detectionIntervalTimeout = setInterval(async () => {
      if (this.released)
        return;
      this.maybeStartDetection();
    }, 60000);
  }

  clearMotionTimeout() {
    clearTimeout(this.motionTimeout);
    this.motionTimeout = undefined;
  }

  resetMotionTimeout() {
    this.clearMotionTimeout();
    this.motionTimeout = setTimeout(() => {
      this.console.log('Motion timed out.');
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
      ret['motionAsObjects'] = true;

    return ret;
  }

  maybeStartDetection() {
    if (!this.hasMotionType) {
      // object detection may be restarted if there are slots available.
      if (this.cameraDevice.motionDetected && this.plugin.canStartObjectDetection())
        this.startPipelineAnalysis();
      return;
    }
  
    // motion sensor should only be started when in replace mode
    if (this.motionSensorSupplementation === BUILTIN_MOTION_SENSOR_REPLACE)
      this.startPipelineAnalysis();
  }

  endObjectDetection() {
    this.detectorSignal.resolve();
  }

  bindObjectDetection() {
    if (this.hasMotionType)
      this.motionDetected = false;

    this.endObjectDetection();

    this.maybeStartDetection();
  }

  async register() {
    const model = await this.objectDetection.getDetectionModel();

    if (!this.hasMotionType) {
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

        this.startPipelineAnalysis();
      });

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
          this.startPipelineAnalysis();
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

  startPipelineAnalysis() {
    if (!this.detectorSignal.finished || this.released)
      return;

    const signal = this.detectorSignal = new Deferred();
    this.detectionStartTime = Date.now();
    if (!this.hasMotionType)
      this.plugin.objectDetectionStarted(this.name, this.console);

    const options = {
      snapshotPipeline: this.plugin.shouldUseSnapshotPipeline(),
    };

    const session = crypto.randomBytes(4).toString('hex');
    const typeName = this.hasMotionType ? 'motion' : 'object';
    this.console.log(`Video Analysis ${typeName} detection session ${session} started.`);

    this.runPipelineAnalysisLoop(signal, options)
      .catch(e => {
        this.console.error('Video Analysis ended with error', e);
      }).finally(() => {
        if (!this.hasMotionType)
          this.plugin.objectDetectionEnded(this.console, options.snapshotPipeline);
        this.console.log(`Video Analysis ${typeName} detection session ${session} ended.`);
        signal.resolve();
      });
  }

  async runPipelineAnalysisLoop(signal: Deferred<void>, options: {
    snapshotPipeline: boolean,
    suppress?: boolean,
  }) {
    while (!signal.finished) {
      if (options.suppress) {
        this.console.log('Resuming motion processing after active motion timeout.');
      }
      const shouldSleep = await this.runPipelineAnalysis(signal, options);
      options.suppress = true;
      if (!shouldSleep || signal.finished)
        return;
      this.console.log('Suspending motion processing during active motion timeout.');
      this.resetMotionTimeout();
      // sleep until a moment before motion duration to start peeking again
      // to have an opporunity to reset the motion timeout.
      await sleep(this.storageSettings.values.motionDuration * 1000 - 4000);
    }
  }

  getCurrentFrameGenerator(snapshotPipeline: boolean) {
    let frameGenerator: string = this.frameGenerator;
    if (!this.hasMotionType && snapshotPipeline) {
      frameGenerator = 'Snapshot';
      this.console.warn(`Due to limited performance, Snapshot mode is being used with ${this.plugin.statsSnapshotConcurrent} actively detecting cameras.`);
    }
    return frameGenerator;
  }

  async createFrameGenerator(signal: Deferred<void>,
    frameGenerator: string,
    options: {
      snapshotPipeline: boolean,
      suppress?: boolean,
    }, updatePipelineStatus: (status: string) => void): Promise<AsyncGenerator<VideoFrame, any, unknown>> {
    if (frameGenerator === 'Snapshot' && !this.hasMotionType) {

      options.snapshotPipeline = true;
      this.console.log('Snapshot', '+', this.objectDetection.name);
      const self = this;
      return (async function* gen() {
        try {
          const flush = async () => { };
          while (!signal.finished) {
            const now = Date.now();
            const sleeper = async () => {
              const diff = now + 1100 - Date.now();
              if (diff > 0)
                await sleep(diff);
            };
            let image: Image & MediaObject;
            try {
              updatePipelineStatus('takePicture');
              const mo = await self.cameraDevice.takePicture({
                reason: 'event',
              });
              updatePipelineStatus('converting image');
              image = await sdk.mediaManager.convertMediaObject(mo, ScryptedMimeTypes.Image);
            }
            catch (e) {
              self.console.error('Video analysis snapshot failed. Will retry in a moment.');
              await sleeper();
              continue;
            }

            // self.console.log('yield')
            updatePipelineStatus('processing image');
            yield {
              __json_copy_serialize_children: true,
              timestamp: now,
              queued: 0,
              flush,
              image,
            };
            // self.console.log('done yield')
            await sleeper();
          }
        }
        finally {
          self.console.log('Snapshot generation finished.');
        }
      })();
    }
    else {
      const destination: MediaStreamDestination = this.hasMotionType ? 'low-resolution' : 'local-recorder';
      const videoFrameGenerator = systemManager.getDeviceById<VideoFrameGenerator>(frameGenerator);
      if (!videoFrameGenerator)
        throw new Error('invalid VideoFrameGenerator');
      if (!options?.suppress)
        this.console.log(videoFrameGenerator.name, '+', this.objectDetection.name);
      updatePipelineStatus('getVideoStream');
      const stream = await this.cameraDevice.getVideoStream({
        prebuffer: this.model.prebuffer,
        destination,
        // ask rebroadcast to mute audio, not needed.
        audio: null,
      });
      updatePipelineStatus('generateVideoFrames');

      try {
        return await videoFrameGenerator.generateVideoFrames(stream, {
          queue: 0,
          fps: this.hasMotionType ? 4 : undefined,
          // this seems to be unused now?
          resize: this.model?.inputSize ? {
            width: this.model.inputSize[0],
            height: this.model.inputSize[1],
          } : undefined,
          // this seems to be unused now?
          format: this.model?.inputFormat,
        });
      }
      finally {
        updatePipelineStatus('waiting first result');
      }
    }
  }

  async runPipelineAnalysis(signal: Deferred<void>, options: {
    snapshotPipeline: boolean,
    suppress?: boolean,
  }) {
    const start = Date.now();

    let lastStatusTime = Date.now();
    let lastStatus = 'starting';
    const updatePipelineStatus = (status: string) => {
      lastStatus = status;
      lastStatusTime = Date.now();
    }

    const interval = setInterval(() => {
      if (Date.now() - lastStatusTime > 30000) {
        signal.resolve();
        this.console.error('VideoAnalysis is hung and will terminate:', lastStatus);
      }
    }, 30000);
    signal.promise.finally(() => clearInterval(interval));

    const currentDetections = new Set<string>();
    let lastReport = 0;

    updatePipelineStatus('waiting result');

    const zones: ObjectDetectionZone[] = [];
    for (const detectorMixin of this.plugin.currentMixins.values()) {
      for (const mixin of detectorMixin.currentMixins.values()) {
        if (mixin.id !== this.id)
          continue;
        for (const [key, zone] of Object.entries(mixin.zones)) {
          const zi = mixin.zoneInfos[key];
          if (!zone?.length || zone?.length < 3)
            continue;
          const odz: ObjectDetectionZone = {
            classes: mixin.hasMotionType ? ['motion'] : zi?.classes,
            exclusion: zi?.exclusion,
            path: zone,
            type: zi?.type,
          }
          zones.push(odz);
        }
      }
    }

    let longObjectDetectionWarning = false;

    const frameGenerator = this.getCurrentFrameGenerator(options.snapshotPipeline);
    for await (const detected of
      await sdk.connectRPCObject(
        await this.objectDetection.generateObjectDetections(
          await this.createFrameGenerator(signal,
            frameGenerator,
            options,
            updatePipelineStatus), {
          settings: {
            ...this.getCurrentSettings(),
            analyzeMode: !!this.analyzeStop,
            frameGenerator,
          },
          sourceId: this.id,
          zones,
        }))) {
      if (signal.finished) {
        break;
      }

      // stop when analyze period ends.
      if (!this.hasMotionType && this.analyzeStop && Date.now() > this.analyzeStop) {
        this.analyzeStop = undefined;
        break;
      }

      if (!longObjectDetectionWarning && !this.hasMotionType && Date.now() - start > 5 * 60 * 1000) {
        longObjectDetectionWarning = true;
        this.console.warn('Camera has been performing object detection for 5 minutes due to persistent motion. This may adversely affect system performance. Read the Optimizing System Performance guide for tips and tricks. https://github.com/koush/nvr.scrypted.app/wiki/Optimizing-System-Performance')
      }

      // apply the zones to the detections and get a shallow copy list of detections after
      // exclusion zones have applied
      const originalDetections = detected.detected.detections;
      const zonedDetections = this.applyZones(detected.detected);
      detected.detected.detections = zonedDetections;

      // this.console.warn('dps', detections / (Date.now() - start) * 1000);

      if (!this.hasMotionType) {
        this.plugin.trackDetection();

        // const numZonedDetections = zonedDetections.filter(d => d.className !== 'motion').length;
        // const numOriginalDetections = originalDetections.filter(d => d.className !== 'motion').length;
        // if (numZonedDetections !== numOriginalDetections)
        //   this.console.log('Zone filtered detections:', numZonedDetections - numOriginalDetections);

        for (const d of detected.detected.detections) {
          currentDetections.add(d.className);
        }

        const now = Date.now();
        if (now > lastReport + 10000) {
          const found = [...currentDetections.values()];
          if (!found.length)
            found.push('[no detections]');
          this.console.log(`[${Math.round((now - start) / 100) / 10}s] Detected:`, ...found);
          currentDetections.clear();
          lastReport = now;
        }
      }

      if (detected.detected.detectionId) {
        updatePipelineStatus('creating jpeg');
        // const start = Date.now();
        let { image } = detected.videoFrame;
        image = await sdk.connectRPCObject(image);
        const jpeg = await image.toBuffer({
          format: 'jpg',
        });
        const mo = await sdk.mediaManager.createMediaObject(jpeg, 'image/jpeg');
        // this.console.log('retain took', Date.now() -start);
        this.setDetection(detected.detected, mo);
        // this.console.log('image saved', detected.detected.detections);
      }
      const motionFound = this.reportObjectDetections(detected.detected);
      if (this.hasMotionType) {
        // if motion is detected, stop processing and exit loop allowing it to sleep.
        if (motionFound) {
          // however, when running in analyze mode, continue to allow viewing motion boxes for test purposes.
          if (!this.analyzeStop || Date.now() > this.analyzeStop) {
            this.analyzeStop = undefined;
            clearInterval(interval);
            return true;
          }
        }
        await sleep(250);
      }
      updatePipelineStatus('waiting result');
      // this.handleDetectionEvent(detected.detected);
    }
  }

  normalizeBox(boundingBox: [number, number, number, number], inputDimensions: [number, number]) {
    let [x, y, width, height] = boundingBox;
    let x2 = x + width;
    let y2 = y + height;
    // the zones are point paths in percentage format
    x = x * 100 / inputDimensions[0];
    y = y * 100 / inputDimensions[1];
    x2 = x2 * 100 / inputDimensions[0];
    y2 = y2 * 100 / inputDimensions[1];
    const box = [[x, y], [x2, y], [x2, y2], [x, y2]];
    return box;
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
      const box = this.normalizeBox(o.boundingBox, detection.inputDimensions);

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

      // if this is a motion sensor and there are no inclusion zones set up,
      // use a default inclusion zone that crops the top and bottom to
      // prevents errant motion from the on screen time changing every second.
      if (this.hasMotionType && included === undefined) {
        const defaultInclusionZone = [[0, 10], [100, 10], [100, 90], [0, 90]];
        included = polygonOverlap(box, defaultInclusionZone);
      }

      // if there are inclusion zones and this object
      // was not in any of them, filter it out.
      if (included === false)
        copy = copy.filter(c => c !== o);
    }

    return copy;
  }

  reportObjectDetections(detection: ObjectsDetected) {
    let motionFound = false;
    if (this.hasMotionType) {
      motionFound = !!detection.detections?.find(d => d.className === 'motion');
      if (motionFound) {
        if (!this.motionDetected)
          this.motionDetected = true;

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

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
    return motionFound;
  }

  setDetection(detection: ObjectsDetected, detectionInput: MediaObject) {
    if (!detection.detectionId)
      detection.detectionId = crypto.randomBytes(4).toString('hex');

    this.console.log('retaining detection image', ...detection.detections);

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

  get frameGenerator() {
    const frameGenerator = this.storageSettings.values.newPipeline as string || 'Default';
    if (frameGenerator === 'Snapshot')
      return frameGenerator;

    if (frameGenerator === 'Default' && !this.hasMotionType && os.cpus().length < 4) {
      this.console.log('Less than 4 processors detected. Defaulting to snapshot mode.');
      return 'Snapshot';
    }

    const pipelines = getAllDevices().filter(d => d.interfaces.includes(ScryptedInterface.VideoFrameGenerator));
    const webcodec = pipelines.find(p => p.nativeId === 'webcodec');
    const gstreamer = pipelines.find(p => p.nativeId === 'gstreamer');
    const libav = pipelines.find(p => p.nativeId === 'libav');
    const ffmpeg = pipelines.find(p => p.nativeId === 'ffmpeg');
    const use = pipelines.find(p => p.name === frameGenerator) || webcodec || gstreamer || libav || ffmpeg;
    return use.id;
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
    this.storageSettings.settings.detectionDurationDEPRECATED.hide = this.hasMotionType;
    this.storageSettings.settings.motionDuration.hide = !this.hasMotionType;

    settings.push(...await this.storageSettings.getSettings());

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
        );
      }
    }

    settings.push(
      {
        title: 'Analyze',
        description: 'Analyzes the video stream for 1 minute. Results will be shown in the Console.',
        key: 'analyzeButton',
        type: 'button',
      },
    );

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
      // await this.snapshotDetection();
      this.startPipelineAnalysis();
      this.analyzeStop = Date.now() + 60000;
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
    this.released = true;
    super.release();
    this.clearMotionTimeout();
    clearInterval(this.detectionIntervalTimeout);
    this.motionListener?.removeListener();
    this.motionMixinListener?.removeListener();
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

    const ret = new ObjectDetectionMixin(this.plugin, mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.mixinProviderNativeId, objectDetection, this.model, group, hasMotionType, settings);
    this.currentMixins.add(ret);
    return ret;
  }

  async releaseMixin(id: string, mixinDevice: ObjectDetectionMixin) {
    this.currentMixins.delete(mixinDevice);
    return mixinDevice.release();
  }

  release(): void {
    super.release();
    for (const m of this.currentMixins) {
      m.release();
    }
    this.currentMixins.clear();
  }
}

interface ObjectDetectionStatistics {
  dps: number;
  sampleTime: number;
}

class ObjectDetectionPlugin extends AutoenableMixinProvider implements Settings, DeviceProvider {
  currentMixins = new Set<ObjectDetectorMixin>();
  objectDetectionStatistics = new Map<number, ObjectDetectionStatistics>();
  statsSnapshotTime: number;
  statsSnapshotDetections: number;
  statsSnapshotConcurrent = 0;
  storageSettings = new StorageSettings(this, {
    maxConcurrentDetections: {
      title: 'Max Concurrent Detections',
      description: `The max number concurrent cameras that will perform object detection while their motion sensor is triggered. Older sessions will be terminated when the limit is reached. The default value is ${getMaxConcurrentObjectDetectionSessions()}.`,
      defaultValue: 'Default',
      combobox: true,
      choices: [
        'Default',
        ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => i.toString()),
      ],
      mapPut: (o, v) => {
        return parseInt(v) || 'Default';
      }
    },
    activeMotionDetections: {
      title: 'Active Motion Detection Sessions',
      multiple: true,
      readonly: true,
      onGet: async () => {
        const motionDetections = [...this.currentMixins.values()]
          .map(d => [...d.currentMixins.values()].filter(dd => dd.hasMotionType)).flat();
        const choices = motionDetections.map(dd => dd.name);
        const value = motionDetections.filter(c => c.detectorRunning).map(dd => dd.name);
        return {
          choices,
          value,
        }
      },
      mapGet: () => {
        const motion = [...this.currentMixins.values()]
          .map(d => [...d.currentMixins.values()].filter(dd => dd.hasMotionType)).flat();
        const value = motion.filter(c => c.detectorRunning).map(dd => dd.name);
        return value;
      },
    },
    activeObjectDetections: {
      title: 'Active Object Detection Sessions',
      multiple: true,
      readonly: true,
      onGet: async () => {
        const objectDetections = [...this.currentMixins.values()]
          .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat();
        const choices = objectDetections.map(dd => dd.name);
        const value = objectDetections.filter(c => c.detectorRunning).map(dd => dd.name);
        return {
          choices,
          value,
        }
      },
      mapGet: () => {
        const motion = [...this.currentMixins.values()]
          .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat();
        const value = motion.filter(c => c.detectorRunning).map(dd => dd.name);
        return value;
      },
    },
  });

  shouldUseSnapshotPipeline() {
    this.pruneOldStatistics();

    // deprecated in favor of object detection session eviction.
    return false;

    // never use snapshot mode if its a single camera.
    if (this.statsSnapshotConcurrent < 2)
      return false;

    // find any concurrent cameras with as many or more that had passable results
    for (const [k, v] of this.objectDetectionStatistics.entries()) {
      if (v.dps > 2 && k >= this.statsSnapshotConcurrent)
        return false;
    }

    // find any concurrent camera with less or as many that had struggle bus
    for (const [k, v] of this.objectDetectionStatistics.entries()) {
      if (v.dps < 2 && k <= this.statsSnapshotConcurrent)
        return true;
    }

    return false;
  }

  pruneOldStatistics() {
    const now = Date.now();
    for (const [k, v] of this.objectDetectionStatistics.entries()) {
      // purge the stats every hour
      if (Date.now() - v.sampleTime > 60 * 60 * 1000)
        this.objectDetectionStatistics.delete(k);
    }
  }

  trackDetection() {
    this.statsSnapshotDetections++;
  }

  get maxConcurrent() {
    let maxConcurrent = this.storageSettings.values.maxConcurrentDetections || 'Default';
    maxConcurrent = Math.max(parseInt(maxConcurrent)) || getMaxConcurrentObjectDetectionSessions();
    return maxConcurrent;
  }

  canStartObjectDetection() {
    const maxConcurrent = this.maxConcurrent;

    const objectDetections = [...this.currentMixins.values()]
      .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat()
      .filter(c => c.detectorRunning)
      .sort((a, b) => a.detectionStartTime - b.detectionStartTime);

    return objectDetections.length < maxConcurrent;
  }

  objectDetectionStarted(name: string, console: Console) {
    this.resetStats(console);

    this.statsSnapshotConcurrent++;

    const maxConcurrent = this.maxConcurrent;

    const objectDetections = [...this.currentMixins.values()]
      .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat()
      .filter(c => c.detectorRunning)
      .sort((a, b) => a.detectionStartTime - b.detectionStartTime);

    while (objectDetections.length > maxConcurrent) {
      const old = objectDetections.shift();
      // allow exceeding the concurrency limit if user interaction triggered analyze.
      if (old.analyzeStop)
        continue;
      old.console.log(`Ending object detection to process activity on ${name}.`);
      old.endObjectDetection();
    }
  }

  objectDetectionEnded(console: Console, snapshotPipeline: boolean) {
    this.resetStats(console, snapshotPipeline);

    this.statsSnapshotConcurrent--;

    const objectDetections = [...this.currentMixins.values()]
    .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat()
    .filter(c => !c.detectorRunning);
    
    for (const notRunning of objectDetections) {
      notRunning.maybeStartDetection();
    }
  }

  resetStats(console: Console, snapshotPipeline?: boolean) {
    const now = Date.now();
    const concurrentSessions = this.statsSnapshotConcurrent;
    if (concurrentSessions) {
      const duration = now - this.statsSnapshotTime;
      const stats: ObjectDetectionStatistics = {
        sampleTime: now,
        dps: this.statsSnapshotDetections / (duration / 1000),
      };

      // ignore short sessions and sessions with no detections (busted?).
      // also ignore snapshot sessions because that will skew/throttle the stats used
      // to determine system dps capabilities.
      if (duration > 10000 && this.statsSnapshotDetections && !snapshotPipeline)
        this.objectDetectionStatistics.set(concurrentSessions, stats);

      this.pruneOldStatistics();

      const str = `video analysis, ${concurrentSessions} camera(s), dps: ${Math.round(stats.dps * 10) / 10} (${this.statsSnapshotDetections}/${Math.round(duration / 1000)})`;
      this.console.log(str);
      console?.log(str);
    }

    this.statsSnapshotDetections = 0;
    this.statsSnapshotTime = now;
  }

  constructor(nativeId?: ScryptedNativeId) {
    super(nativeId);

    process.nextTick(() => {
      sdk.deviceManager.onDevicesChanged({
        devices: [
          {
            name: 'FFmpeg Frame Generator',
            type: ScryptedDeviceType.Builtin,
            interfaces: [
              ScryptedInterface.VideoFrameGenerator,
            ],
            nativeId: 'ffmpeg',
          }
        ]
      })
    })
  }

  async getDevice(nativeId: string): Promise<any> {
    if (nativeId === 'ffmpeg')
      return new FFmpegVideoFrameGenerator('ffmpeg');
  }

  async releaseDevice(id: string, nativeId: string): Promise<void> {
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

  async releaseMixin(id: string, mixinDevice: ObjectDetectorMixin): Promise<void> {
    // what does this mean to make a mixin provider no longer available?
    // just ignore it until reboot?
    this.currentMixins.delete(mixinDevice);
    return mixinDevice.release();
  }
}

export default ObjectDetectionPlugin;
