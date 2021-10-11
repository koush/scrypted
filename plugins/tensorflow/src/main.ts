import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, EventListenerRegister, ObjectDetector, ObjectDetection, PictureOptions, ScryptedDeviceBase, DeviceProvider, ScryptedDevice, ObjectDetectionResult, FaceRecognition, ObjectDetectionTypes } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import * as tf from '@tensorflow/tfjs-node-gpu';
import type { DetectedObject } from '@tensorflow-models/coco-ssd'
import * as coco from '@tensorflow-models/coco-ssd';
import path from 'path';
import fetch from 'node-fetch';
import { ENV, string, Tensor, tensor, Tensor4D } from '@tensorflow/tfjs-core';
import * as faceapi from 'face-api.js';
import { FaceDetection, FaceMatcher, LabeledFaceDescriptors } from 'face-api.js';
import canvas, { createCanvas } from 'canvas';
import { Canvas, Image, ImageData } from 'canvas';
import { randomBytes } from 'crypto';
import throttle from 'lodash/throttle'
import { sleep } from './sleep';
import { CLASSES } from './classes';
import { makeBoundingBox, makeBoundingBoxFromFace } from './util';

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

const ssdPromise = coco.load();
observeLoadError(ssdPromise);
const fdnPromise = faceapi.nets.ssdMobilenetv1.loadFromDisk('./');
observeLoadError(fdnPromise);
const flnPromise = faceapi.nets.faceLandmark68Net.loadFromDisk('./');
observeLoadError(flnPromise);
const frnPromise = faceapi.nets.faceRecognitionNet.loadFromDisk('./');
observeLoadError(frnPromise);

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

  async getPictureOptions?(): Promise<void | PictureOptions[]> {
  }
}

class TensorFlowMixin extends SettingsMixinDeviceBase<ObjectDetector> implements ObjectDetector, Settings {
  released = false;
  registerMotion: EventListenerRegister;
  registerObject: EventListenerRegister;
  detections = new Map<string, Buffer>();
  realDevice: ScryptedDevice & Camera & VideoCamera & ObjectDetector;
  minConfidence = parseInt(this.storage.getItem('minConfidence')) || defaultMinConfidence;
  objectInterval = parseInt(this.storage.getItem('objectInterval')) || defaultObjectInterval;
  recognitionInterval = parseInt(this.storage.getItem('recognitionInterval')) || defaultRecognitionInterval;
  detectionDuration = parseInt(this.storage.getItem('detectionDuration')) || defaultDetectionDuration;
  currentDetections: string[] = [];
  currentPeople = new Set<string>();

  throttledObjectDetect = throttle(
    async (buffer: Buffer, input: tf.Tensor3D) => {
      this.objectDetect(buffer, input);
    },
    1000);

  throttledFaceDetect = throttle(
    async (buffer: Buffer, input: tf.Tensor3D, detection: ObjectDetection) => {
      this.faceDetect(buffer, input, detection);
    },
    1000);

  throttledGrab = throttle(async () => {
    const video = await this.realDevice.takePicture();
    const buffer = await mediaManager.convertMediaObjectToBuffer(video, 'image/jpeg');
    const input = tf.node.decodeJpeg(buffer, 3);

    setTimeout(() => input.dispose(), 30000);
    return {
      buffer, input,
    }
  }, 500);

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, public tensorFlow: TensorFlow) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId: tensorFlow.nativeId,
      mixinDeviceInterfaces,
      group: "Object Detection Settings",
      groupKey: "tensorflow",
    });

    this.realDevice = systemManager.getDeviceById<Camera & VideoCamera & ObjectDetector>(this.id);
    this.registerMotion = this.realDevice.listen(ScryptedInterface.MotionSensor, async () => {
      const types = await this.getNativeObjectTypes();
      if (types.detections?.includes('person'))
        return;

      let { buffer, input } = await this.throttledGrab();

      for (let i = 0; i < 10; i++) {
        this.throttledObjectDetect(buffer, input);
        await sleep(1000);
        buffer = undefined;
        input = undefined;
      }
    });

    this.registerObject = this.realDevice.listen(ScryptedInterface.ObjectDetector, async (es, ed, detection: ObjectDetection) => {
      let video = await this.realDevice.getDetectionInput(detection.detectionId);
      let buffer = video ? await mediaManager.convertMediaObjectToBuffer(video, 'image/jpeg') : undefined;
      let input = buffer ? tf.node.decodeJpeg(buffer, 3) : undefined;

      for (let i = 0; i < 10; i++) {
        this.throttledFaceDetect(buffer, input, detection);
        await sleep(1000);
        buffer = undefined;
        input?.dispose();
        input = undefined;
      }
    });
  }

  async objectDetect(buffer: Buffer, input: tf.Tensor3D) {
    if (!buffer) {
      const grab = await this.throttledGrab();
      buffer = grab.buffer;
      input = grab.input;
    }

    const ssd = await ssdPromise;
    const detections: DetectedObject[] = await ssd.detect(input as any);
    const detectionId = Math.random().toString();
    const detection: ObjectDetection = {
      timestamp: Date.now(),
      detectionId,
      inputDimensions: [input.shape[1], input.shape[0]],
      detections: detections.map(detection => ({
        className: detection.class,
        score: detection.score,
        boundingBox: detection.bbox,
      })),
    }

    this.detections.set(detectionId, buffer);
    setTimeout(() => this.detections.delete(detectionId), 30000);

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);

    const found: string[] = [];
    const classNames = detections.map(d => d.class);
    for (const className of classNames) {
      const index = this.currentDetections.indexOf(className);
      if (index === -1) {
        found.push(className);
      }
      else {
        this.currentDetections.splice(index, 1);
      }
    }

    // anything remaining in currentDetections at this point has left the scene.
    if (this.currentDetections.length) {
      this.console.log('object no longer detected', this.currentDetections.join(', '))
    }
    if (found.length) {
      this.console.log('object detected', found.join(', '));
    }
    this.currentDetections = [...classNames];
  }

  async faceDetect(buffer: Buffer, input: tf.Tensor3D, detection: ObjectDetection) {
    if (!buffer) {
      const grab = await this.throttledGrab();
      buffer = grab.buffer;
      input = grab.input;
    }

    const person = detection.detections.find(detection => detection.className === 'person');

    // no people
    const recognition: ObjectDetection = Object.assign({}, detection);
    if (!person) {
      this.onDeviceEvent(ScryptedInterface.ObjectDetector, recognition);
      return;
    }

    const facesDetected = await faceapi.detectAllFaces(input, new faceapi.SsdMobilenetv1Options({
      minConfidence: this.minConfidence,
    }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    // no faces
    if (!facesDetected.length) {
      this.onDeviceEvent(ScryptedInterface.ObjectDetector, recognition);
      return;
    }

    const faces: ObjectDetectionResult[] = facesDetected.map(face => ({
      className: 'face',
      score: face.detection.score,
      boundingBox: makeBoundingBoxFromFace(face),
    }))

    recognition.people = [];
    recognition.faces = faces;

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
        recognition.people.push({
          id: nativeId,
          label: deviceManager.getDeviceState(nativeId)?.name,
          score: 1 - match.m.distance,
          boundingBox: makeBoundingBoxFromFace(match.q),
        });
      }
    }

    if (unknowns.length) {
      const fullPromise = canvas.loadImage(buffer);

      for (const unknown of unknowns) {
        const nativeId = 'person:' + Buffer.from(randomBytes(8)).toString('hex');

        recognition.people.push({
          id: nativeId,
          label: `Unknown Person (${nativeId})`,
          score: unknown.r.score,
          boundingBox: makeBoundingBox(unknown.r.box),
        });


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

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, recognition);

    const missing: string[] = [];
    for (const check of recognition.people) {
      if (!this.currentPeople.has(check.id)) {
        missing.push(check.id);
      }
      else {
        this.currentPeople.delete(check.id);
      }
    }

    if (this.currentPeople.size) {
      this.console.log('object no longer detected', [...this.currentDetections].join(', '))
    }
    if (recognition.people.length) {
      this.console.log('object detected', recognition.people.map(p => p.label).join(', '));
    }

    this.currentPeople.clear();
    for (const add of recognition.people) {
      this.currentPeople.add(add.id);
    }
  }

  async getNativeObjectTypes(): Promise<ObjectDetectionTypes> {
    if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
      return this.mixinDevice.getObjectTypes();
    return {};
  }

  async getObjectTypes(): Promise<ObjectDetectionTypes> {
    const detections = this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector)
      ? await this.getNativeObjectTypes()
      : Object.values(CLASSES).map(c => c.displayName);

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
    const buffer = this.detections.get(detectionId);
    if (!buffer) {
      if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
        return this.mixinDevice.getDetectionInput(detectionId);
      return;
    }
    return mediaManager.createMediaObject(buffer, 'image/jpeg');
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
    throw new Error('Method not implemented.');
  }

  async putSetting(key: string, value: string | number | boolean): Promise<void> {
    throw new Error('Method not implemented.');
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
