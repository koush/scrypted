import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, EventListenerRegister, ObjectDetector, ObjectDetection, PictureOptions, ScryptedDeviceBase, DeviceProvider, ScryptedDevice, ObjectDetectionResult, FaceRecognition, ObjectDetectionTypes, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import * as tf from '@tensorflow/tfjs-node-gpu';
import { ENV, tensor3d } from '@tensorflow/tfjs-node-gpu';
import * as coco from '@tensorflow-models/coco-ssd';
import path from 'path';
import fetch from 'node-fetch';
import * as faceapi from '@koush/face-api.js';
import { FaceDetection, FaceMatcher, LabeledFaceDescriptors } from '@koush/face-api.js';
import canvas, { createCanvas } from 'canvas';
import { Canvas, Image, ImageData } from 'canvas';
import { randomBytes } from 'crypto';
import throttle from 'lodash/throttle'
import { sleep } from './sleep';
import { CLASSES } from './classes';
import { makeBoundingBox, makeBoundingBoxFromFace } from './util';
import { FFMpegRebroadcastSession, startRebroadcastSession } from '../../../common/src/ffmpeg-rebroadcast';
import { createRawVideoParser, PIXEL_FORMAT_RGB24, StreamChunk } from '@scrypted/common/src/stream-parser';
import { once } from 'events';
import { DenoisedDetectionEntry, denoiseDetections, DetectionInput } from './denoise';
import { decodeJpeg, encodeJpeg } from './jpeg';
import fs from 'fs';
import { listenZeroCluster } from '@scrypted/common/src/listen-cluster';
import { Server } from 'http';

const DISPOSE_TIMEOUT = 10000;

// do not delete this, it makes sure tf is initialized.
console.log(tf.getBackend());

faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);
ENV.global.fetch = fetch as any;
ENV.global.Canvas = Canvas as any;
ENV.global.ImageData = ImageData as any;
ENV.global.Image = Image as any;

function observeLoadError(promise: Promise<any>) {
  promise.catch(e => console.error('load error', e));
}

const ssdPromise = (async () => {
  // setWasmPaths('wasm/')

  // await tf.setBackend('wasm');
  const fdnPromise = faceapi.nets.ssdMobilenetv1.loadFromDisk('./');
  observeLoadError(fdnPromise);
  const flnPromise = faceapi.nets.faceLandmark68Net.loadFromDisk('./');
  observeLoadError(flnPromise);
  const frnPromise = faceapi.nets.faceRecognitionNet.loadFromDisk('./');
  observeLoadError(frnPromise);

  const server = new Server();
  server.on('request', async (req, res) => {
    try {
      const check = path.join(process.env.SCRYPTED_PLUGIN_VOLUME, req.url);
      const realfs = require('realfs');
      let buffer: Buffer;
      if (realfs.existsSync(check)) {
        buffer = realfs.readFileSync(check);
      }
      else {
        const url = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2' + req.url;
        const response = await fetch(url);
        buffer = await response.buffer();
        realfs.writeFileSync(check, buffer);
      }
      res.write(buffer);
      res.end();
    }
    catch (e) {
      res.statusCode = 404;
      res.write('');
      res.end();
    }
  });
  const port = await listenZeroCluster(server);

  return coco.load({
    modelUrl: `http://127.0.0.1:${port}/model.json`,
  });
})();

const { deviceManager, mediaManager, systemManager } = sdk;

const defaultMaxRetained = 15;
const defaultMinConfidence = 0.5;
const defaultObjectInterval = 1000;
const defaultRecognitionInterval = 1000;
const defaultDetectionDuration = 10000;

class RecognizedPerson extends ScryptedDeviceBase implements Camera, Settings {
  maxRetained = parseInt(this.storage.getItem('maxRetained')) || defaultMaxRetained;

  constructor(public tensorFlow: TensorFlow, nativeId: string) {
    super(nativeId);

    systemManager.listenDevice(this.id, ScryptedInterface.ScryptedDevice, () => tensorFlow.reloadFaceMatcher());
  }

  async getSettings(): Promise<Setting[]> {
    const settings: Setting[] = [
      {
        title: 'Max Retained Faces',
        description: 'The number of faces to keep for matching',
        type: 'number',
        key: 'maxRetained',
        value: this.maxRetained.toString(),
      }
    ];

    const people = this.tensorFlow.getAllPeople();
    if (!people.length)
      return settings;

    const merge: Setting = {
      title: 'Merge With...',
      description: 'Merge this person with a different person. This will remove the other person.',
      key: 'merge',
      type: 'string',
      choices: people.filter(person => person.nativeId !== this.nativeId).map(person => person.name + ` (${person.nativeId})`),
    }
    settings.push(merge);

    return settings;
  }

  setMaxRetained() {
    this.storage.setItem('maxRetained', this.maxRetained.toString());
  }

  async putSetting(key: string, value: string | number | boolean): Promise<void> {
    if (key === 'maxRetained') {
      this.maxRetained = parseInt(value.toString()) || defaultMaxRetained;
      this.setMaxRetained();
      return;
    }

    if (key !== 'merge')
      return;

    const person = this.tensorFlow.getAllPeople().find(person => value === person.name + ` (${person.nativeId})`)
    if (!person)
      return;

    const other = this.tensorFlow.getAllDescriptors(person);
    const mine = this.tensorFlow.getAllDescriptors(this);
    const all = [...other, ...mine];

    while (all.length > this.maxRetained) {
      const r = Math.round(Math.random() * all.length);
      all.splice(r, 1);
    }

    this.storage.clear();
    this.setMaxRetained();

    all.forEach((d, i) => {
      this.storage.setItem('descriptor-' + i, Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString('base64'))
    });

    await deviceManager.onDeviceRemoved(person.nativeId);
    this.tensorFlow.reloadFaceMatcher();
  }

  async takePicture(options?: PictureOptions): Promise<MediaObject> {
    const jpeg = require('realfs').readFileSync(path.join(process.env.SCRYPTED_PLUGIN_VOLUME, this.nativeId + '.jpg'));
    return mediaManager.createMediaObject(jpeg, 'image/jpeg');
  }

  async getPictureOptions(): Promise<PictureOptions[]> {
    return;
  }
}

class TensorFlowMixin extends SettingsMixinDeviceBase<ObjectDetector> implements ObjectDetector, Settings {
  released = false;
  registerMotion: EventListenerRegister;
  registerObject: EventListenerRegister;
  detections = new Map<string, DetectionInput>();
  realDevice: ScryptedDevice & Camera & VideoCamera & ObjectDetector;
  minConfidence = parseInt(this.storage.getItem('minConfidence')) || defaultMinConfidence;
  objectInterval = parseInt(this.storage.getItem('objectInterval')) || defaultObjectInterval;
  recognitionInterval = parseInt(this.storage.getItem('recognitionInterval')) || defaultRecognitionInterval;
  detectionDuration = parseInt(this.storage.getItem('detectionDuration')) || defaultDetectionDuration;
  currentDetections: DenoisedDetectionEntry<ObjectDetectionResult>[] = [];
  currentPeople: DenoisedDetectionEntry<FaceRecognition>[] = [];
  rebroadcaster: Promise<FFMpegRebroadcastSession>;
  rebroadcasterTimeout: NodeJS.Timeout;

  throttledObjectDetect = throttle(
    async (detectionInput: DetectionInput) => {
      const ret = this.objectDetect(detectionInput);
      ret.catch(e => this.console.error('object detect error', e));
      return ret;
    },
    1000);

  throttledFaceDetect = throttle(
    async (detectionInput: DetectionInput) => {
      const ret = this.faceDetect(detectionInput);
      ret.catch(e => this.console.error('face detect error', e));
      return ret;
    },
    1000);

  throttledGrab = throttle(async () => {

    if (!this.rebroadcaster) {
      // start the frame grabber if necessary
      const video = await this.realDevice.getVideoStream();
      const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(video, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
      if (!this.rebroadcaster) {
        this.rebroadcaster = startRebroadcastSession(ffmpegInput, {
          console: this.console,
          parsers: {
            'rawvideo': createRawVideoParser({
              pixelFormat: PIXEL_FORMAT_RGB24,
            })
          }
        })

        this.rebroadcaster.then(session => {
          session.events.on('killed', () => {
            this.rebroadcaster = undefined;
          })
          session.events.on('error', e => this.console.log('ffmpeg error', e))
        })
      }
    }

    const session = await this.rebroadcaster;

    // reset/start the frame grabber timeout to quit after 10 seconds of idle.
    // various detection loops will keep this alive.
    clearTimeout(this.rebroadcasterTimeout);
    this.rebroadcasterTimeout = setTimeout(() => session.kill(), 10000);

    const args = await once(session.events, 'rawvideo-data');
    const chunk: StreamChunk = args[0];

    const input = tensor3d(Buffer.concat(chunk.chunks), [
      session.ffmpegInputs.rawvideo.mediaStreamOptions.video.height,
      session.ffmpegInputs.rawvideo.mediaStreamOptions.video.width,
      3,
    ]);

    setTimeout(() => input.dispose(), DISPOSE_TIMEOUT);
    return {
      jpegBuffer: undefined, input,
    } as DetectionInput
  }, 500);

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, public tensorFlow: TensorFlow) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId: tensorFlow.nativeId,
      mixinDeviceInterfaces,
      group: "Object Detection Settings",
      groupKey: "tensorflow",
    });

    this.realDevice = systemManager.getDeviceById<Camera & VideoCamera & ObjectDetector>(this.id);

    this.register();
  }

  async register() {
    // const nativeTypes = await this.getNativeObjectTypes();

    this.registerMotion = this.realDevice.listen(ScryptedInterface.MotionSensor, async () => {
      // if (nativeTypes.detections?.includes('person'))
      //   return;

      let detectionInput = await this.throttledGrab();

      // on motion, watch what happens for 10 seconds.
      // new objects being found will trigger a longer observation.
      for (let i = 0; i < 10; i++) {
        await this.throttledObjectDetect(detectionInput);
        await sleep(1000);
        detectionInput = undefined;
      }
    });

    this.registerObject = this.realDevice.listen(ScryptedInterface.ObjectDetector, async (es, ed, detection: ObjectDetection) => {
      // ignore face/people detection. already processed.
      if (detection.faces || detection.people)
        return;

      // no person, ignore it
      const person = detection && detection.detections.find(detection => detection.className === 'person');
      if (!person)
        return;

      let detectionInput = this.detections.get(detection.detectionId);
      if (!detectionInput) {
        let video = await this.realDevice.getDetectionInput(detection.detectionId);
        const buffer = video ? await mediaManager.convertMediaObjectToBuffer(video, 'image/jpeg') : undefined;
        if (buffer) {
          const input = decodeJpeg(buffer, 3);
          detectionInput = {
            input, jpegBuffer: buffer,
          }
        }
      }

      // on object detection, watch what happens for 10 seconds.
      // new people being found will trigger a longer observation.
      for (let i = 0; i < 10; i++) {
        await this.throttledFaceDetect(detectionInput);
        await sleep(1000);
        detectionInput?.input?.dispose();
        detectionInput = undefined;
      }
    });
  }

  reportObjectDetections(detectionInput?: DetectionInput) {
    const detectionId = Math.random().toString();
    const detection: ObjectDetection = {
      timestamp: Date.now(),
      detectionId: detectionInput ? detectionId : undefined,
      inputDimensions: detectionInput
        ? [detectionInput?.input.shape[1], detectionInput?.input.shape[0]]
        : undefined,
      detections: this.currentDetections.map(d => d.detection),
    }

    if (detectionInput)
      this.setDetection(detectionId, detectionInput);

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
  }

  async extendedObjectDetect() {
    for (let i = 0; i < 60; i++) {
      await this.throttledObjectDetect(undefined);
      await sleep(1000);
    }
  }

  async objectDetect(detectionInput: DetectionInput) {
    if (!detectionInput) {
      detectionInput = await this.throttledGrab();
    }

    const { input } = detectionInput;

    const ssd = await ssdPromise;
    const detections = await ssd.detect(input);
    // this.console.log('memory', tf.memory());

    const found: DenoisedDetectionEntry<ObjectDetectionResult>[] = [];
    denoiseDetections<ObjectDetectionResult>(this.currentDetections, detections.map(detection => ({
      name: detection.class,
      detection: {
        className: detection.class,
        score: detection.score,
        boundingBox: detection.bbox,
      },
    })), {
      added: d => found.push(d),
      removed: d => {
        this.console.log('no longer detected', d.name)
        this.reportObjectDetections()
      }
    });
    if (found.length) {
      this.console.log('detected', found.map(d => d.detection.className).join(', '));
      this.extendedObjectDetect();
    }

    this.reportObjectDetections(detectionInput);
  }

  setDetection(detectionId: string, detectionInput: DetectionInput) {
    this.detections.set(detectionId, detectionInput);
    setTimeout(() => {
      this.detections.delete(detectionId);
      detectionInput?.input?.dispose();
    }, DISPOSE_TIMEOUT);
  }

  reportPeopleDetections(faces?: ObjectDetectionResult[], detectionInput?: DetectionInput) {
    const detectionId = Math.random().toString();
    const detection: ObjectDetection = {
      timestamp: Date.now(),
      detectionId: detectionInput ? detectionId : undefined,
      inputDimensions: detectionInput
        ? [detectionInput?.input.shape[1], detectionInput?.input.shape[0]]
        : undefined,
      people: this.currentPeople.map(d => d.detection),
      faces,
    }

    if (detectionInput)
      this.setDetection(detectionId, detectionInput);

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
  }

  async extendedFaceDetect() {
    for (let i = 0; i < 60; i++) {
      await this.throttledFaceDetect(undefined);
      await sleep(1000);
    }
  }

  async faceDetect(detectionInput: DetectionInput) {
    let faces: ObjectDetectionResult[] = [];
    let people: FaceRecognition[] = [];
    const report = () => {
      denoiseDetections(this.currentPeople, [],
        {
          removed: d => {
            this.console.log('no longer detected', d.detection.label)
            this.reportPeopleDetections(faces, detectionInput);
          },
        })

      this.reportPeopleDetections(faces, detectionInput);
    }

    if (!detectionInput) {
      detectionInput = await this.throttledGrab();
    }

    const { input } = detectionInput;
    const facesDetected = await faceapi.detectAllFaces(input, new faceapi.SsdMobilenetv1Options({
      minConfidence: this.minConfidence,
    }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    // no faces
    if (!facesDetected.length) {
      report();
      return;
    }

    faces = facesDetected.map(face => ({
      className: 'face',
      score: face.detection.score,
      boundingBox: makeBoundingBoxFromFace(face),
    }));

    const unknowns: {
      q: Float32Array,
      r: FaceDetection,
    }[] = [];
    if (!this.tensorFlow.faceMatcher) {
      unknowns.push(...facesDetected.map(f => ({
        q: f.descriptor,
        r: f.detection,
      })));
    }
    else {
      const matches = await Promise.all(facesDetected.map(async (q) => ({
        q,
        m: this.tensorFlow.faceMatcher.findBestMatch(q.descriptor),
      })));

      unknowns.push(...matches.filter(match => match.m.label === 'unknown').map(match => ({
        q: match.q.descriptor,
        r: match.q.detection
      })));

      for (const match of matches) {
        if (match.m.label === 'unknown')
          continue;

        const nativeId = match.m.label;
        people.push({
          id: nativeId,
          label: deviceManager.getDeviceState(nativeId)?.name,
          score: 1 - match.m.distance,
          boundingBox: makeBoundingBoxFromFace(match.q),
        });
      }
    }

    if (unknowns.length) {
      let fullPromise: Promise<canvas.Image>;
      const autoAdd = this.tensorFlow.storage.getItem('autoAdd') !== 'false';

      for (const unknown of unknowns) {
        const nativeId = 'person:' + Buffer.from(randomBytes(8)).toString('hex');

        people.push({
          id: nativeId,
          label: `Unknown Person (${nativeId})`,
          score: unknown.r.score,
          boundingBox: makeBoundingBox(unknown.r.box),
        });

        if (!autoAdd)
          continue;

        if (!fullPromise) {
          const buffer = detectionInput.jpegBuffer || Buffer.from(await encodeJpeg(input));
          if (!detectionInput.jpegBuffer)
            detectionInput.jpegBuffer = buffer;
          fullPromise = canvas.loadImage(buffer);
        }

        await this.tensorFlow.discoverPerson(nativeId);
        const storage = deviceManager.getDeviceStorage(nativeId);
        const d = unknown.q;
        storage.setItem('descriptor-0', Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString('base64'));

        (async () => {
          const full = await fullPromise;
          const c = createCanvas(unknown.r.box.width, unknown.r.box.height);
          const draw = c.getContext('2d');
          draw.drawImage(full,
            unknown.r.box.x, unknown.r.box.y, unknown.r.box.width, unknown.r.box.height,
            0, 0, unknown.r.box.width, unknown.r.box.height);
          const cropped = c.toBuffer('image/jpeg');

          require('realfs').writeFileSync(path.join(process.env.SCRYPTED_PLUGIN_VOLUME, nativeId + '.jpg'), cropped)
        })();
      }

      this.tensorFlow.reloadFaceMatcher();
    }

    const found: DenoisedDetectionEntry<FaceRecognition>[] = [];
    denoiseDetections(this.currentPeople, people.map(person => ({
      detection: person,
      name: person.label,
    })),
      {
        added: d => found.push(d),
        removed: d => {
          this.console.log('no longer detected', d.detection.label)
          report();
        },
      });

    const actualNew: DenoisedDetectionEntry<FaceRecognition>[] = [];
    // after denoising, resolve all newly found people against the current list.
    for (const person of found) {
      let index: number;
      if (person.detection.label.startsWith('Unknown Person')) {
        // new unknowns may possibly be unrecognizable and thus missing faces this pass
        // first try to resolve with a missing unknown person
        index = this.currentPeople.findIndex(check => check.detection.label.startsWith('Unknown Person') && check.timeout);
        // otherwise resolve with a missing known person
        if (index === -1)
          index = this.currentPeople.findIndex(check => !check.detection.label.startsWith('Unknown Person') && check.timeout);
      }
      else {
        // new people may possibly be unrecognizable people and thus missing from the previous pass
        index = this.currentPeople.findIndex(check => check.detection.label.startsWith('Unknown Person') && check.timeout);
      }
      // todo: sort by closest bounding box or something
      if (index !== -1) {
        clearTimeout(this.currentPeople[index].timeout);
        this.currentPeople.splice(index, 1);
      }
      else {
        actualNew.push(person);
      }
    }

    if (actualNew.length) {
      this.console.log('detected', actualNew.map(d => d.detection.label).join(', '));
      this.extendedFaceDetect()
    }
    this.reportPeopleDetections(faces, detectionInput);

    for (const person of this.currentDetections) {
      person.detection.boundingBox = undefined;
      person.detection.score = undefined;
    }
  }

  async getNativeObjectTypes(): Promise<ObjectDetectionTypes> {
    if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
      return this.mixinDevice.getObjectTypes();
    return {};
  }

  async getObjectTypes(): Promise<ObjectDetectionTypes> {
    return {
      detections: Object.values(CLASSES).map(c => c.displayName),
      faces: true,
      people: this.tensorFlow.getAllPeople().map(person => ({
        id: person.nativeId,
        label: person.name,
      })),
    }
  }

  async getDetectionInput(detectionId: any): Promise<MediaObject> {
    const detection = this.detections.get(detectionId);
    if (!detection) {
      if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
        return this.mixinDevice.getDetectionInput(detectionId);
      return;
    }
    if (!detection.jpegBuffer) {
      detection.jpegBuffer = Buffer.from(await encodeJpeg(detection.input));
    }
    return mediaManager.createMediaObject(detection.jpegBuffer, 'image/jpeg');
  }

  async getMixinSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Minimum Face Detection Confidence',
        description: 'Higher values eliminate false positives and low quality recognition candidates.',
        key: 'minConfidence',
        type: 'number',
        value: this.minConfidence.toString(),
      },
      {
        title: 'Detection Duration',
        description: 'The duration to process video when an event occurs.',
        key: 'detectionDuration',
        type: 'number',
        value: this.detectionDuration.toString(),
      },
      {
        title: 'Object Detection Interval',
        description: 'The interval used to detect objects when motion is detected',
        key: 'objectInterval',
        type: 'number',
        value: this.objectInterval.toString(),
      },
      {
        title: 'Face Recognition Interval',
        description: 'The interval used to recognize faces when a person is detected',
        key: 'recognitionInterval',
        type: 'number',
        value: this.recognitionInterval.toString(),
      },
    ];
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    const vs = value.toString();
    this.storage.setItem(key, vs);
    if (key === 'minConfidence') {
      this.minConfidence = parseInt(vs) || 0.5;
    }
    else if (key === 'detectionDuration') {
      this.detectionDuration = parseInt(vs) || defaultDetectionDuration;
    }
    else if (key === 'objectInterval') {
      this.objectInterval = parseInt(vs) || defaultObjectInterval;
    }
    else if (key === 'recognitionInterval') {
      this.recognitionInterval = parseInt(vs) || defaultRecognitionInterval;
    }
  }

  release() {
    this.released = true;
    this.registerMotion?.removeListener();
    this.registerObject?.removeListener();
  }
}

class TensorFlow extends AutoenableMixinProvider implements MixinProvider, DeviceProvider, Settings {
  faceMatcher: FaceMatcher;

  constructor(nativeId?: string) {
    super(nativeId);

    // trigger trigger tensorflow.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera & Settings>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.getSettings();
    }

    for (const person of this.getAllPeople()) {
      this.discoverPerson(person.nativeId);
    }

    this.reloadFaceMatcher();
  }

  discoverPerson(nativeId: string) {
    return deviceManager.onDeviceDiscovered({
      nativeId,
      name: 'Unknown Person',
      type: ScryptedDeviceType.Person,
      interfaces: [ScryptedInterface.Camera, ScryptedInterface.Settings],
    });
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Automatically Add New Faces',
        description: 'Automatically new faces to Scrypted when found. It is recommended to disable this once the people in your household have been added.',
        value: (this.storage.getItem('autoAdd') !== 'false').toString(),
        type: 'boolean',
        key: 'autoAdd',
      }
    ]
  }

  async putSetting(key: string, value: string | number | boolean): Promise<void> {
    this.storage.setItem(key, value.toString());
  }

  reloadFaceMatcher() {
    const labelledDescriptors: LabeledFaceDescriptors[] = [];
    for (const device of this.getAllPeople()) {
      const label = device.nativeId;
      const descriptors = this.getAllDescriptors(device);

      if (!descriptors.length)
        continue;

      labelledDescriptors.push(new LabeledFaceDescriptors(label, descriptors));
    }

    if (labelledDescriptors.length)
      this.faceMatcher = new FaceMatcher(labelledDescriptors);
  }

  async discoverDevices(duration: number): Promise<void> {
  }

  getAllDescriptors(device: ScryptedDeviceBase) {
    const descriptors: Float32Array[] = [];
    for (let i = 0; i < device.storage.length; i++) {
      const key = device.storage.key(i);
      if (!key.startsWith('descriptor-'))
        continue;
      try {
        const buffer = Buffer.from(device.storage.getItem(key), 'base64');
        const descriptor = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
        descriptors.push(descriptor);
      }
      catch (e) {
      }
    }
    return descriptors;
  }

  getAllPeople(): ScryptedDeviceBase[] {
    return deviceManager.getNativeIds().filter(nativeId => nativeId?.startsWith('person:'))
      .map(nativeId => new ScryptedDeviceBase(nativeId));
  }

  async getDevice(nativeId: string) {
    if (nativeId.startsWith('person:'))
      return new RecognizedPerson(this, nativeId);
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if ((interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.Camera))
      && interfaces.includes(ScryptedInterface.MotionSensor)) {
      return [ScryptedInterface.ObjectDetector, ScryptedInterface.Settings];
    }
    return null;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    this.setHasEnabledMixin(mixinDeviceState.id);
    return new TensorFlowMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new TensorFlow();
