import { Deferred } from '@scrypted/common/src/deferred';
import { sleep } from '@scrypted/common/src/sleep';
import sdk, { Camera, DeviceCreator, DeviceCreatorSettings, DeviceProvider, EventListenerRegister, MediaObject, MediaStreamDestination, MixinDeviceBase, MixinProvider, MotionSensor, ObjectDetection, ObjectDetectionModel, ObjectDetectionTypes, ObjectDetectionZone, ObjectDetector, ObjectsDetected, Point, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, SettingValue, Settings, VideoCamera, VideoFrame, VideoFrameGenerator, WritableDeviceState } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import { AutoenableMixinProvider } from "../../../common/src/autoenable-mixin-provider";
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFmpegVideoFrameGenerator } from './ffmpeg-videoframes';
import { fixLegacyClipPath, normalizeBox, polygonContainsBoundingBox, polygonIntersectsBoundingBox } from './polygon';
import { SMART_MOTIONSENSOR_PREFIX, SmartMotionSensor } from './smart-motionsensor';
import { SMART_OCCUPANCYSENSOR_PREFIX, SmartOccupancySensor } from './smart-occupancy-sensor';
import { getAllDevices, safeParseJson } from './util';
import { FFmpegAudioDetectionMixinProvider } from './ffmpeg-audiosensor';


const { systemManager } = sdk;

const defaultPostMotionAnalysisDuration = 20;
const defaultMotionDuration = 30;

const BUILTIN_MOTION_SENSOR_ASSIST = 'Assist';
const BUILTIN_MOTION_SENSOR_REPLACE = 'Replace';

// at 5fps object detection speed, the camera is considered throttled.
// throttling may be due to cpu, gpu, npu or whatever.
// regardless, purging low fps object detection sessions will likely
// restore performance.
const fpsKillWaterMark = 5
const fpsLowWaterMark = 7;
// cameras may have low performance due to low framerate or intensive tasks such as
// LPR and face recognition. if multiple cams are in low performance mode, then
// the system may be struggling.
const lowPerformanceMinThreshold = 2;

const objectDetectionPrefix = `${ScryptedInterface.ObjectDetection}:`;

type ClipPath = Point[];
type Zones = { [zone: string]: ClipPath };
interface ZoneInfo {
  exclusion?: boolean;
  filterMode?: 'include' | 'exclude' | 'observe';
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
    zones: {
      title: 'Zones',
      type: 'string',
      description: 'Enter the name of a new zone or delete an existing zone.',
      multiple: true,
      combobox: true,
      choices: [],
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
    postMotionAnalysisDuration: {
      title: 'Post Motion Analysis Duration',
      subgroup: 'Advanced',
      description: 'The duration in seconds to analyze video after motion ends.',
      type: 'number',
      defaultValue: defaultPostMotionAnalysisDuration,
    },
    motionDuration: {
      title: 'Motion Duration',
      description: 'The duration in seconds to wait to reset the motion sensor.',
      type: 'number',
      defaultValue: defaultMotionDuration,
    },
    newPipeline: {
      subgroup: 'Advanced',
      title: 'Decoder',
      description: 'Configure how frames are provided to the video analysis pipeline.',
      onGet: async () => {
        const choices = [
          'Default',
          ...getAllDevices().filter(d => d.interfaces.includes(ScryptedInterface.VideoFrameGenerator)).map(d => d.name),
        ];
        return {
          hide: this.model?.decoder,
          choices,
        }
      },
      onPut: () => {
        this.endObjectDetection();
        this.maybeStartDetection();
      },
      defaultValue: 'Default',
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
  sampleHistory: number[] = [];
  // settings: Setting[];

  get detectorRunning() {
    return !this.detectorSignal.finished;
  }

  constructor(public plugin: ObjectDetectionPlugin, mixinDevice: VideoCamera & Camera & MotionSensor & ObjectDetector & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState, providerNativeId: string, public objectDetection: ObjectDetection & ScryptedDevice, public model: ObjectDetectionModel, group: string, public hasMotionType: boolean) {
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

    // ensure motion sensors stay alive. plugin will manage object detection throttling.
    if (this.hasMotionType) {
      this.detectionIntervalTimeout = setInterval(async () => {
        if (this.released)
          return;
        this.maybeStartDetection();
      }, 60000);
    }

    this.storageSettings.settings.zones.mapGet = () => Object.keys(this.zones);
    this.storageSettings.settings.zones.onGet = async () => {
      return {
        group,
        choices: Object.keys(this.zones),
      }
    }
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
    const settings = this.model.settings;
    if (!settings)
      return { id: this.id };

    const ret: { [key: string]: any } = {};
    for (const setting of settings) {
      let value: any;
      if (setting.multiple) {
        value = safeParseJson(this.storage.getItem(setting.key));
        if (!value?.length)
          value = undefined;
      }
      else {
        value = this.storage.getItem(setting.key);
        if (setting.type === 'number')
          value = parseFloat(value);
      }
      value ||= setting.value;

      ret[setting.key] = value;
    }

    if (this.hasMotionType)
      ret['motionAsObjects'] = true;

    return {
      ...ret,
      id: this.id,
    };
  }

  maybeStartDetection() {
    if (!this.hasMotionType) {
      // object detection may be restarted if there are slots available.
      if (this.cameraDevice.motionDetected && this.plugin.canStartObjectDetection(this)) {
        this.startPipelineAnalysis();
        return true;
      }
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
    if (!this.hasMotionType) {
      this.motionListener = this.cameraDevice.listen(ScryptedInterface.MotionSensor, async () => {
        if (!this.cameraDevice.motionDetected) {
          // const minimumEndTme = this.detectionStartTime + this.storageSettings.values.minimumDetectionDuration * 1000;
          // const sleepTime = minimumEndTme - Date.now();
          const sleepTime = this.storageSettings.values.postMotionAnalysisDuration * 1000;

          if (sleepTime > 0) {
            this.console.log('Motion stopped. Waiting additional time for minimum detection duration:', sleepTime);
            await sleep(sleepTime);
            if (this.motionDetected) {
              this.console.log('Motion resumed during wait. Continuing detection.');
              return;
            }
          }

          if (this.detectorRunning) {
            // allow anaysis due to user request.
            if (this.analyzeStop > Date.now())
              return;

            this.console.log('Motion stopped, stopping detection.')
            this.endObjectDetection();
          }
          return;
        }

        this.maybeStartDetection();
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
            this.console.log('Built in motion sensor started motion, starting video detection.');
          this.startPipelineAnalysis();
          return;
        }

        this.clearMotionTimeout();
        if (this.detectorRunning) {
          this.console.log('Built in motion sensor ended motion, stopping video detection.')
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

    const options = {};

    const session = crypto.randomBytes(4).toString('hex');
    const typeName = this.hasMotionType ? 'motion' : 'object';
    this.console.log(`Video Analysis ${typeName} detection session ${session} started.`);

    this.runPipelineAnalysisLoop(signal, options)
      .catch(e => {
        this.console.error('Video Analysis ended with error', e);
      }).finally(() => {
        if (!this.hasMotionType)
          this.plugin.objectDetectionEnded(this.console);
        this.console.log(`Video Analysis ${typeName} detection session ${session} ended.`);
        signal.resolve();
      });
  }

  async runPipelineAnalysisLoop(signal: Deferred<void>, options: {
    suppress?: boolean,
  }) {
    await this.updateModel();
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

  async createFrameGenerator(frameGenerator: string,
    options: {
      suppress?: boolean,
    }, updatePipelineStatus: (status: string) => void): Promise<AsyncGenerator<VideoFrame, any, unknown> | MediaObject> {

    const destination: MediaStreamDestination = this.hasMotionType ? 'low-resolution' : 'local-recorder';
    updatePipelineStatus('getVideoStream');
    const stream = await this.cameraDevice.getVideoStream({
      prebuffer: this.model.prebuffer,
      destination,
    });

    if (this.model.decoder) {
      if (!options?.suppress)
        this.console.log(this.objectDetection.name, '(with builtin decoder)');
      return stream;
    }

    const videoFrameGenerator = systemManager.getDeviceById<VideoFrameGenerator>(frameGenerator);
    if (!videoFrameGenerator)
      throw new Error('invalid VideoFrameGenerator');
    if (!options?.suppress)
      this.console.log(videoFrameGenerator.name, '+', this.objectDetection.name);
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

  async runPipelineAnalysis(signal: Deferred<void>, options: {
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

    const currentDetections = new Map<string, number>();
    let lastReport = 0;

    updatePipelineStatus('waiting result');

    const zones: ObjectDetectionZone[] = [];
    for (const detectorMixin of this.plugin.currentMixins.values()) {
      for (const mixin of detectorMixin.currentMixins.values()) {
        if (mixin.id !== this.id)
          continue;
        for (const [key, zone] of Object.entries(mixin.zones)) {
          const zi = mixin.zoneInfos[key];
          if (!zone?.length || zone?.length < 3 || zi?.filterMode === 'observe')
            continue;
          const odz: ObjectDetectionZone = {
            classes: mixin.hasMotionType ? ['motion'] : zi?.classes,
            exclusion: zi?.filterMode ? zi?.filterMode === 'exclude' : zi?.exclusion,
            path: zone,
            type: zi?.type,
          }
          zones.push(odz);
        }
      }
    }

    let longObjectDetectionWarning = false;

    const frameGenerator = this.model.decoder ? undefined : this.getFrameGenerator();
    for await (const detected of
      await sdk.connectRPCObject(
        await this.objectDetection.generateObjectDetections(
          await this.createFrameGenerator(
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

      const now = Date.now();

      // stop when analyze period ends.
      if (!this.hasMotionType && this.analyzeStop && now > this.analyzeStop) {
        this.analyzeStop = undefined;
        break;
      }

      this.purgeSampleHistory(now);
      this.sampleHistory.push(now);

      if (!longObjectDetectionWarning && !this.hasMotionType && now - start > 5 * 60 * 1000) {
        longObjectDetectionWarning = true;
        this.console.warn('Camera has been performing object detection for 5 minutes due to persistent motion. This may adversely affect system performance. Read the Optimizing System Performance guide for tips and tricks. https://github.com/koush/nvr.scrypted.app/wiki/Optimizing-System-Performance')
      }

      // apply the zones to the detections and get a shallow copy list of detections after
      // exclusion zones have applied
      const originalDetections = detected.detected.detections;
      const zonedDetections = this.applyZones(detected.detected);
      detected.detected.detections = zonedDetections;

      if (!this.hasMotionType) {
        this.plugin.trackDetection();

        const numZonedDetections = zonedDetections.filter(d => d.className !== 'motion').length;
        const numOriginalDetections = originalDetections.filter(d => d.className !== 'motion').length;
        if (numZonedDetections !== numOriginalDetections)
          currentDetections.set('filtered', (currentDetections.get('filtered') || 0) + 1);

        for (const d of detected.detected.detections) {
          currentDetections.set(d.className, Math.max(currentDetections.get(d.className) || 0, d.score));
        }

        if (now > lastReport + 10000) {
          const found = [...currentDetections.entries()].map(([className, score]) => `${className} (${score})`);
          if (!found.length)
            found.push('[no detections]');
          this.console.log(`[${Math.round((now - start) / 100) / 10}s] Detected:`, ...found);
          currentDetections.clear();
          lastReport = now;
        }
      }

      if (detected.detected.detectionId) {
        updatePipelineStatus('creating jpeg');
        let { image } = detected.videoFrame;
        image = await sdk.connectRPCObject(image);
        const jpeg = await image.toBuffer({
          format: 'jpg',
        });
        const mo = await sdk.mediaManager.createMediaObject(jpeg, 'image/jpeg');
        this.setDetection(detected.detected, mo);
      }
      const motionFound = this.reportObjectDetections(detected.detected);
      if (this.hasMotionType) {
        // if motion is detected, stop processing and exit loop allowing it to sleep.
        if (motionFound) {
          // however, when running in analyze mode, continue to allow viewing motion boxes for test purposes.
          if (!this.analyzeStop || now > this.analyzeStop) {
            this.analyzeStop = undefined;
            clearInterval(interval);
            return true;
          }
        }
        await sleep(250);
      }
      updatePipelineStatus('waiting result');
    }
  }

  purgeSampleHistory(now: number) {
    while (this.sampleHistory.length && now - this.sampleHistory[0] > 10000) {
      this.sampleHistory.shift();
    }
  }

  get detectionFps() {
    const now = Date.now();
    this.purgeSampleHistory(now);
    const first = this.sampleHistory[0];
    // require at least 5 seconds of samples.
    if (!first || (now - first) < 8000)
      return Infinity;
    return this.sampleHistory.length / ((now - first) / 1000);
  }

  applyZones(detection: ObjectsDetected) {
    // determine zones of the objects, if configured.
    if (!detection.detections)
      return [];
    let copy = detection.detections.slice();
    for (const o of detection.detections) {
      if (!o.boundingBox)
        continue;

      const box = normalizeBox(o.boundingBox, detection.inputDimensions);

      let included: boolean;
      // need a way to explicitly include package zone.
      if (o.zones)
        included = true;
      else
        o.zones = [];
      for (let [zone, zoneValue] of Object.entries(this.zones)) {
        zoneValue = fixLegacyClipPath(zoneValue);
        if (zoneValue.length < 3) {
          // this.console.warn(zone, 'Zone is unconfigured, skipping.');
          continue;
        }

        // object detection may report motion, don't filter these at all.
        if (!this.hasMotionType && o.className === 'motion')
          continue;

        const zoneInfo = this.zoneInfos[zone];
        const exclusion = zoneInfo?.filterMode ? zoneInfo.filterMode === 'exclude' : zoneInfo?.exclusion;
        // track if there are any inclusion zones
        if (!exclusion && !included && zoneInfo?.filterMode !== 'observe')
          included = false;

        let match = false;
        if (zoneInfo?.type === 'Contain') {
          match = polygonContainsBoundingBox(zoneValue, box);
        }
        else {
          match = polygonIntersectsBoundingBox(zoneValue, box);
        }

        const classes = zoneInfo?.classes?.length ? zoneInfo?.classes : this.model?.classes || [];
        if (match && classes.length) {
          match = classes.includes(o.className);
        }
        if (match) {
          o.zones.push(zone);

          if (zoneInfo?.filterMode !== 'observe') {
            if (exclusion && match) {
              copy = copy.filter(c => c !== o);
              break;
            }

            included = true;
          }
        }
      }

      // if this is a motion sensor and there are no inclusion zones set up,
      // use a default inclusion zone that crops the top and bottom to
      // prevents errant motion from the on screen time changing every second.
      if (this.hasMotionType && included === undefined) {
        const defaultInclusionZone: ClipPath = [[0, .1], [1, .1], [1, .9], [0, .9]];
        included = polygonIntersectsBoundingBox(defaultInclusionZone, box);
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
    }, 10000);
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
    ret.classes.push(...(await this.objectDetection.getDetectionModel(this.getCurrentSettings())).classes);
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
    if (!this.interfaces.includes(ScryptedInterface.MotionSensor))
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

  getFrameGenerator() {
    let frameGenerator = this.storageSettings.values.newPipeline as string;
    if (frameGenerator === 'Default')
      frameGenerator = this.plugin.storageSettings.values.defaultDecoder || 'Default';

    const pipelines = getAllDevices().filter(d => d.interfaces.includes(ScryptedInterface.VideoFrameGenerator));
    const webassembly = sdk.systemManager.getDeviceById('@scrypted/nvr', 'decoder') || undefined;
    const gstreamer = sdk.systemManager.getDeviceById('@scrypted/python-codecs', 'gstreamer') || undefined;
    const libav = sdk.systemManager.getDeviceById('@scrypted/python-codecs', 'libav') || undefined;
    const ffmpeg = sdk.systemManager.getDeviceById('@scrypted/objectdetector', 'ffmpeg') || undefined;
    const use = pipelines.find(p => p.name === frameGenerator) || webassembly || gstreamer || libav || ffmpeg;
    return use.id;
  }

  async updateModel() {
    try {
      this.model = await this.objectDetection.getDetectionModel(this.getCurrentSettings());
    }
    catch (e) {
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    await this.updateModel();
    const modelSettings = this.model.settings;

    if (modelSettings) {
      settings.push(...modelSettings.map(setting => {
        let value: any;
        if (setting.multiple) {
          value = safeParseJson(this.storage.getItem(setting.key));
          if (!value?.length)
            value = undefined;
        }
        else {
          value = this.storage.getItem(setting.key);
        }
        value ||= setting.value;
        return Object.assign({}, setting, {
          placeholder: setting.placeholder?.toString(),
          value,
        } as Setting);
      }));
    }

    this.storageSettings.settings.motionSensorSupplementation.hide = !this.hasMotionType || !this.mixinDeviceInterfaces.includes(ScryptedInterface.MotionSensor);
    this.storageSettings.settings.postMotionAnalysisDuration.hide = this.hasMotionType;
    this.storageSettings.settings.motionDuration.hide = !this.hasMotionType;

    settings.push(...await this.storageSettings.getSettings());

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

      // settings.push({
      //   subgroup,
      //   key: `zoneinfo-exclusion-${name}`,
      //   title: `Exclusion Zone`,
      //   description: 'Detections in this zone will be excluded.',
      //   type: 'boolean',
      //   value: zi?.exclusion,
      // });
      settings.push({
        subgroup,
        key: `zoneinfo-filterMode-${name}`,
        title: `Filter Mode`,
        description: 'The filter mode used by this zone. The Default is include. Zones set to observe will not affect filtering and can be used for automations.',
        choices: [
          'Default',
          'include',
          'exclude',
          'observe',
        ],
        value: zi?.filterMode || (zi?.exclusion ? 'exclude' : undefined) || 'Default',
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
        const classes = this.model.classes;
        settings.push(
          {
            subgroup,
            key: `zoneinfo-classes-${name}`,
            title: `Detection Classes`,
            description: 'The detection classes to match inside this zone.',
            choices: classes || [],
            value: zi?.classes?.length ? zi?.classes : classes || [],
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
        this.zones[zoneName] = Array.isArray(value) ? value : JSON.parse(vs);
        this.storage.setItem('zones', JSON.stringify(this.zones));
      }
      return;
    }
    if (key.startsWith('zoneinfo-')) {
      const [zkey, ...zoneNameParts] = key.substring('zoneinfo-'.length).split('-');
      const zoneName = zoneNameParts.join('-');
      this.zoneInfos[zoneName] ||= {};
      this.zoneInfos[zoneName][zkey] = value;
      this.storage.setItem('zoneInfos', JSON.stringify(this.zoneInfos));
      return;
    }

    if (this.storageSettings.settings[key]) {
      return this.storageSettings.putSetting(key, value);
    }

    if (value) {
      const found = this.model.settings?.find(s => s.key === key);
      if (found?.multiple || found?.type === 'clippath')
        vs = JSON.stringify(value);
    }

    if (key === 'analyzeButton') {
      this.startPipelineAnalysis();
      this.analyzeStop = Date.now() + 60000;
    }
    else {
      const settings = this.getCurrentSettings();
      if (settings && key in settings) {
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

  constructor(mixinDevice: ObjectDetection, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState, public plugin: ObjectDetectionPlugin, public model: ObjectDetectionModel) {
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

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState) {
    let objectDetection = systemManager.getDeviceById<ObjectDetection>(this.id);
    const hasMotionType = this.model.classes.includes('motion');
    const group = hasMotionType ? 'Motion Detection' : 'Object Detection';
    const model = await objectDetection.getDetectionModel({ id: mixinDeviceState.id });
    // const group = objectDetection.name.replace('Plugin', '').trim();

    const ret = new ObjectDetectionMixin(this.plugin, mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.mixinProviderNativeId, objectDetection, model, group, hasMotionType);
    this.currentMixins.add(ret);
    return ret;
  }

  async releaseMixin(id: string, mixinDevice: ObjectDetectionMixin) {
    this.currentMixins.delete(mixinDevice);
    return mixinDevice?.release();
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

export class ObjectDetectionPlugin extends AutoenableMixinProvider implements Settings, DeviceProvider, DeviceCreator {
  currentMixins = new Set<ObjectDetectorMixin>();
  objectDetectionStatistics = new Map<number, ObjectDetectionStatistics>();
  statsSnapshotTime: number;
  statsSnapshotDetections: number;
  statsSnapshotConcurrent = 0;
  storageSettings = new StorageSettings(this, {
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
    defaultDecoder: {
      group: 'Advanced',
      onGet: async () => {
        const choices = [
          'Default',
          ...getAllDevices().filter(d => d.interfaces.includes(ScryptedInterface.VideoFrameGenerator)).map(d => d.name),
        ];
        return {
          choices,
        }
      },
      defaultValue: 'Default',
    },
    developerMode: {
      group: 'Advanced',
      title: 'Developer Mode',
      description: 'Developer mode enables usage of the raw detector object detectors. Using raw object detectors (ie, outside of Scrypted NVR) can cause severe performance degradation.',
      type: 'boolean',
    },
  });
  devices = new Map<string, any>();

  constructor(nativeId?: ScryptedNativeId) {
    super(nativeId, 'v5');

    this.systemDevice = {
      deviceCreator: 'Smart Sensor',
    };

    process.nextTick(() => {
      sdk.deviceManager.onDeviceDiscovered({
        name: 'FFmpeg Frame Generator',
        type: ScryptedDeviceType.Internal,
        interfaces: [
          ScryptedInterface.VideoFrameGenerator,
        ],
        nativeId: 'ffmpeg',
      });

      sdk.deviceManager.onDeviceDiscovered({
        name: 'FFmpeg Audio Detection',
        type: ScryptedDeviceType.Internal,
        interfaces: [
          ScryptedInterface.MixinProvider,
        ],
        nativeId: 'ffmpeg-audio-detection',
      });
    });

    // on an interval check to see if system load allows squelched detectors to start up.
    setInterval(() => {
      const runningDetections = this.runningObjectDetections;

      // don't allow too many cams to start up at once if resuming from a low performance state.
      let allowStart = 2;

      // allow minimum amount of concurrent cameras regardless of system specs
      if (runningDetections.length > lowPerformanceMinThreshold) {
        // if anything is below the kill threshold, do not start
        const killable = runningDetections.filter(o => o.detectionFps < fpsKillWaterMark && !o.analyzeStop);
        if (killable.length > lowPerformanceMinThreshold) {
          const cameraNames = runningDetections.map(o => `${o.name} ${o.detectionFps}`).join(', ');
          const first = killable[0];
          first.console.warn(`System at capacity. Ending object detection.`, cameraNames);
          first.endObjectDetection();
          return;
        }

        const lowWatermark = runningDetections.filter(o => o.detectionFps < fpsLowWaterMark);
        if (lowWatermark.length > lowPerformanceMinThreshold)
          allowStart = 1;
      }

      const idleDetectors = [...this.currentMixins.values()]
        .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat()
        .filter(c => !c.detectorRunning);

      for (const notRunning of idleDetectors) {
        if (notRunning.maybeStartDetection()) {
          allowStart--;
          if (allowStart <= 0)
            return;
        }
      }
    }, 5000)
  }

  checkHasEnabledMixin(device: ScryptedDevice): boolean {
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

  canStartObjectDetection(mixin: ObjectDetectionMixin) {
    const runningDetections = this.runningObjectDetections;

    // already running
    if (runningDetections.find(o => o.id === mixin.id))
      return false;

    // allow minimum amount of concurrent cameras regardless of system specs
    if (runningDetections.length < lowPerformanceMinThreshold)
      return true;

    // find any cameras struggling with a with low detection fps.
    const lowWatermark = runningDetections.filter(o => o.detectionFps < fpsLowWaterMark);
    if (lowWatermark.length > lowPerformanceMinThreshold) {
      const [first] = lowWatermark;
      // if cameras have been detecting enough to catch the activity, kill it for new camera.
      const cameraNames = runningDetections.map(o => `${o.name} ${o.detectionFps}`).join(', ');
      if (Date.now() - first.detectionStartTime > 30000) {
        first.console.warn(`System at capacity. Ending object detection to process activity on ${mixin.name}.`, cameraNames);
        first.endObjectDetection();
        mixin.console.warn(`System at capacity. Ending object detection on ${first.name} to process activity.`, cameraNames);
        return true;
      }

      mixin.console.warn(`System at capacity. Not starting object detection to continue processing recent activity on ${first.name}.`, cameraNames);
      return false;
    }

    // System capacity is fine. Start the detection.
    return true;
  }

  get runningObjectDetections() {
    const runningDetections = [...this.currentMixins.values()]
      .map(d => [...d.currentMixins.values()].filter(dd => !dd.hasMotionType)).flat()
      .filter(c => c.detectorRunning)
      .sort((a, b) => a.detectionStartTime - b.detectionStartTime);
    return runningDetections;
  }

  objectDetectionStarted(name: string, console: Console) {
    this.resetStats(console);

    this.statsSnapshotConcurrent++;
  }

  objectDetectionEnded(console: Console) {
    this.resetStats(console);

    this.statsSnapshotConcurrent--;
  }

  resetStats(console: Console) {
    const now = Date.now();
    const concurrentSessions = this.statsSnapshotConcurrent;
    if (concurrentSessions) {
      const duration = now - this.statsSnapshotTime;
      const stats: ObjectDetectionStatistics = {
        sampleTime: now,
        dps: this.statsSnapshotDetections / (duration / 1000),
      };

      // ignore short sessions and sessions with no detections (busted?).
      if (duration > 10000 && this.statsSnapshotDetections)
        this.objectDetectionStatistics.set(concurrentSessions, stats);

      this.pruneOldStatistics();

      const str = `video analysis, ${concurrentSessions} camera(s), dps: ${Math.round(stats.dps * 10) / 10} (${this.statsSnapshotDetections}/${Math.round(duration / 1000)})`;
      this.console.log(str);
      console?.log(str);
    }

    this.statsSnapshotDetections = 0;
    this.statsSnapshotTime = now;
  }

  async getDevice(nativeId: string): Promise<any> {
    let ret: any;
    if (nativeId === 'ffmpeg')
      ret = this.devices.get(nativeId) || new FFmpegVideoFrameGenerator('ffmpeg');
    if (nativeId === 'ffmpeg-audio-detection')
      ret = this.devices.get(nativeId) || new FFmpegAudioDetectionMixinProvider('ffmpeg-audio-detection');
    if (nativeId?.startsWith(SMART_MOTIONSENSOR_PREFIX))
      ret = this.devices.get(nativeId) || new SmartMotionSensor(this, nativeId);
    if (nativeId?.startsWith(SMART_OCCUPANCYSENSOR_PREFIX))
      ret = this.devices.get(nativeId) || new SmartOccupancySensor(this, nativeId);

    if (ret)
      this.devices.set(nativeId, ret);
    return ret;
  }

  async releaseDevice(id: string, nativeId: string): Promise<void> {
    if (nativeId?.startsWith(SMART_MOTIONSENSOR_PREFIX)) {
      const smart = this.devices.get(nativeId) as SmartMotionSensor;
      smart?.detectionListener?.removeListener();
      smart?.resetMotionTimeout();
    }
    if (nativeId?.startsWith(SMART_OCCUPANCYSENSOR_PREFIX)) {
      const smart = this.devices.get(nativeId) as SmartOccupancySensor;
      smart?.detectionListener?.removeListener();
      smart?.resetOccupiedTimeout();
      smart?.clearOccupancyInterval();
    }
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
    if (!this.storageSettings.values.developerMode && !interfaces.includes(ScryptedInterface.ObjectDetectionGenerator))
      return;
    return [ScryptedInterface.MixinProvider];
  }

  async getMixin(mixinDevice: ObjectDetection, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
    const model = await mixinDevice.getDetectionModel();
    const ret = new ObjectDetectorMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this, model);
    this.currentMixins.add(ret);
    return ret;
  }

  async releaseMixin(id: string, mixinDevice: ObjectDetectorMixin): Promise<void> {
    // what does this mean to make a mixin provider no longer available?
    // just ignore it until reboot?
    this.currentMixins.delete(mixinDevice);
    return mixinDevice?.release();
  }

  async getCreateDeviceSettings(): Promise<Setting[]> {
    return [
      {
        key: 'sensorType',
        title: 'Sensor Type',
        description: 'Select the type of sensor to create.',
        choices: [
          'Smart Motion Sensor',
          'Smart Occupancy Sensor',
        ],
      },
      {
        key: 'camera',
        title: 'Camera',
        description: 'Select a camera or doorbell.',
        type: 'device',
        deviceFilter: `type === '${ScryptedDeviceType.Doorbell}' || type === '${ScryptedDeviceType.Camera}'`,
      },
    ];
  }

  async createDevice(settings: DeviceCreatorSettings): Promise<string> {
    const sensorType = settings.sensorType;
    const camera = sdk.systemManager.getDeviceById(settings.camera as string);
    if (sensorType === 'Smart Motion Sensor') {
      const nativeId = SMART_MOTIONSENSOR_PREFIX + crypto.randomBytes(8).toString('hex');
      let name = camera.name || 'New';
      name += ' Smart Motion Sensor'

      const id = await sdk.deviceManager.onDeviceDiscovered({
        nativeId,
        name,
        type: ScryptedDeviceType.Sensor,
        interfaces: [
          ScryptedInterface.Camera,
          ScryptedInterface.MotionSensor,
          ScryptedInterface.Settings,
          ScryptedInterface.Readme,
        ]
      });

      const sensor = new SmartMotionSensor(this, nativeId);
      sensor.storageSettings.values.objectDetector = camera?.id;

      return id;
    }
    else if (sensorType === 'Smart Occupancy Sensor') {
      const nativeId = SMART_OCCUPANCYSENSOR_PREFIX + crypto.randomBytes(8).toString('hex');
      let name = camera.name || 'New';
      name += ' Smart Occupancy Sensor'

      const id = await sdk.deviceManager.onDeviceDiscovered({
        nativeId,
        name,
        type: ScryptedDeviceType.Sensor,
        interfaces: [
          ScryptedInterface.OccupancySensor,
          ScryptedInterface.Settings,
          ScryptedInterface.Readme,
        ]
      });

      const sensor = new SmartOccupancySensor(this, nativeId);
      sensor.storageSettings.values.camera = camera?.id;

      return id;
    }
  }
}

export default ObjectDetectionPlugin;
