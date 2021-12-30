import { ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, ObjectDetection, PictureOptions, ScryptedDeviceBase, DeviceProvider, ScryptedMimeTypes, FFMpegInput, ObjectsDetected, ObjectDetectionModel, ObjectDetectionSession, ObjectDetectionResult } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import * as tf from '@tensorflow/tfjs-node-gpu';
import { ENV, tensor3d, Tensor3D } from '@tensorflow/tfjs-node-gpu';
import path from 'path';
import fetch from 'node-fetch';
import * as faceapi from '@koush/face-api.js';
import { FaceDetection, FaceMatcher, LabeledFaceDescriptors } from '@koush/face-api.js';
import canvas, { createCanvas } from 'canvas';
import { Canvas, Image, ImageData } from 'canvas';
import { randomBytes } from 'crypto';
import { sleep } from './sleep';
import { makeBoundingBoxFromFace } from './util';
import { FFMpegRebroadcastSession, startRebroadcastSession } from '../../../common/src/ffmpeg-rebroadcast';
import { createRawVideoParser, PIXEL_FORMAT_RGB24, StreamChunk } from '@scrypted/common/src/stream-parser';
import { alertRecommendedPlugins } from '@scrypted/common/src/alert-recommended-plugins';
import { once } from 'events';
import { decodeJpeg, encodeJpeg } from './jpeg';
import { EventEmitter } from 'stream';

const DISPOSE_TIMEOUT = 10000;
const defaultThreshold = .4

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

const faceapiPromise = (async () => {
  const fdnPromise = faceapi.nets.ssdMobilenetv1.loadFromDisk('./');
  observeLoadError(fdnPromise);
  const flnPromise = faceapi.nets.faceLandmark68Net.loadFromDisk('./');
  observeLoadError(flnPromise);
  const frnPromise = faceapi.nets.faceRecognitionNet.loadFromDisk('./');
  observeLoadError(frnPromise);

  await Promise.all([fdnPromise, flnPromise, frnPromise]);
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

interface DetectionSession {
  id: string;
  minScore: number;
  events: EventEmitter;
  running?: boolean;

  rebroadcaster?: Promise<FFMpegRebroadcastSession>;
  rebroadcasterTimeout?: NodeJS.Timeout;
}

class TensorFlow extends ScryptedDeviceBase implements ObjectDetection, DeviceProvider, Settings {
  faceMatcher: FaceMatcher;
  detectionSessions = new Map<string, DetectionSession>();
  recognitionInterval = parseInt(this.storage.getItem('recognitionInterval')) || defaultRecognitionInterval;

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

    alertRecommendedPlugins({
      '@scrypted/objectdetector': 'Object Detection Plugin',
    });
  }

  async addUnknowns(unknowns: { descriptor: Float32Array, nativeId: string, detection: FaceDetection }[], input: Tensor3D, buffer: Buffer) {
    const newDescriptors = this.faceMatcher?.labeledDescriptors?.slice() || [];
    newDescriptors.push(...unknowns.map(unk => new LabeledFaceDescriptors('person:' + unk.nativeId, [unk.descriptor])));
    this.faceMatcher = new FaceMatcher(newDescriptors);

    let fullPromise: Promise<canvas.Image>;
    const autoAdd = this.storage.getItem('autoAdd') !== 'false';
    if (!autoAdd)
      return;

    for (const unknown of unknowns) {
      if (!fullPromise) {
        fullPromise = (async () => {
          const b = buffer || Buffer.from(await encodeJpeg(input));
          return canvas.loadImage(b);
        })();
      }

      const rawNativeId = unknown.nativeId;
      const nativeId = 'person:' + rawNativeId;
      await this.discoverPerson(nativeId);
      const storage = deviceManager.getDeviceStorage(nativeId);
      const d = unknown.descriptor;
      storage.setItem('descriptor-0', Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString('base64'));

      (async () => {
        const full = await fullPromise;
        const c = createCanvas(unknown.detection.box.width, unknown.detection.box.height);
        const draw = c.getContext('2d');
        draw.drawImage(full,
          unknown.detection.box.x, unknown.detection.box.y, unknown.detection.box.width, unknown.detection.box.height,
          0, 0, unknown.detection.box.width, unknown.detection.box.height);
        const cropped = c.toBuffer('image/jpeg');

        require('realfs').writeFileSync(path.join(process.env.SCRYPTED_PLUGIN_VOLUME, nativeId + '.jpg'), cropped)
      })();
    }
  }

  async getDetections(detectionId: string, input: Tensor3D, jpegBuffer: Buffer, minScore: number) {
    await faceapiPromise;
    const facesDetected = await faceapi.detectAllFaces(input, new faceapi.SsdMobilenetv1Options({
      minConfidence: minScore || undefined,
    }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    const faces = facesDetected.map(face => ({
      className: 'face',
      score: face.detection.score,
      boundingBox: makeBoundingBoxFromFace(face),
    }));
    let people: ObjectDetectionResult[] = undefined;

    if (this.faceMatcher) {
      people = [];

      const matches = await Promise.all(facesDetected.map(async (faceDetection) => ({
        faceDetection,
        faceMatch: this.faceMatcher.findBestMatch(faceDetection.descriptor),
      })));

      const unknowns = matches.filter(match => match.faceMatch.label === 'unknown');

      for (const match of matches) {
        if (match.faceMatch.label === 'unknown')
          continue;

        const nativeId = match.faceMatch.label;
        people.push({
          id: nativeId,
          className: deviceManager.getDeviceState(nativeId)?.name,
          score: 1 - match.faceMatch.distance,
          boundingBox: makeBoundingBoxFromFace(match.faceDetection),
        });
      }

      if (unknowns.length) {
        this.addUnknowns(unknowns.map(unk => ({
          detection: unk.faceDetection.detection,
          descriptor: unk.faceDetection.descriptor,
          nativeId: randomBytes(8).toString('hex'),
        })), input, jpegBuffer);
      }
    }
    else if (faces.length) {
      this.addUnknowns(facesDetected.map(face => ({
        descriptor: face.descriptor,
        detection: face.detection,
        nativeId: randomBytes(8).toString('hex'),
      })), input, jpegBuffer)
    }

    const detection: ObjectsDetected = {
      timestamp: Date.now(),
      detectionId,
      inputDimensions: [input.shape[1], input.shape[0]],
      detections: people,
    }

    return detection;
  }

  async detectObjects(mediaObject: MediaObject, session?: ObjectDetectionSession): Promise<ObjectsDetected> {
    let detectionSession = this.detectionSessions.get(session?.detectionId);
    let detectionId = session?.detectionId;
    const duration = session?.duration;
    const settings = session?.settings;

    const isImage = mediaObject?.mimeType?.startsWith('image/');

    let ending = false;

    if (!isImage && !detectionId)
      detectionId = randomBytes(8).toString('hex');

    if (!duration && !isImage) {
      ending = true;
    }
    else if (detectionId && !detectionSession) {
      if (!mediaObject)
        throw new Error(`session ${detectionId} inactive and no mediaObject provided`);

      detectionSession = {
        id: detectionId,
        minScore : settings?.minScore || defaultThreshold,
        events: new EventEmitter(),
      };
      this.detectionSessions.set(detectionId, detectionSession);
      detectionSession.events.once('ended', () => this.endSession(detectionSession));
    }

    if (ending) {
      if (detectionSession)
        this.endSession(detectionSession);
      return;
    }

    if (isImage) {
      const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/jpeg');
      const input = decodeJpeg(buffer, 3);
      return this.getDetections(detectionId, input, buffer, settings?.minScore || defaultThreshold);
    }

    const newSession = !detectionSession.running;
    if (newSession)
      detectionSession.running = true;

    clearTimeout(detectionSession.rebroadcasterTimeout);
    detectionSession.rebroadcasterTimeout = setTimeout(() => detectionSession.rebroadcaster?.then(rb => rb.kill()), duration);
    if (settings?.minScore !== undefined)
      detectionSession.minScore = settings?.minScore;

    if (!newSession) {
      this.console.log('existing session', detectionSession.id);
      return;
    }

    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(mediaObject, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
    const rebroadcaster = startRebroadcastSession(ffmpegInput, {
      console: this.console,
      parsers: {
        'rawvideo': createRawVideoParser({
          pixelFormat: PIXEL_FORMAT_RGB24,
        })
      }
    })

    rebroadcaster.then(session => {
      session.events.on('killed', () => {
        detectionSession.rebroadcaster = undefined;
      });
      session.events.on('error', e => this.console.log('ffmpeg error', e))
    });

    (async () => {
      const session = await rebroadcaster;
      try {
        while (detectionSession.running) {
          const args = await once(session.events, 'rawvideo-data');
          if (!detectionSession.running)
            return;
          const chunk: StreamChunk = args[0];

          const input = tensor3d(Buffer.concat(chunk.chunks), [
            session.ffmpegInputs.rawvideo.mediaStreamOptions.video.height,
            session.ffmpegInputs.rawvideo.mediaStreamOptions.video.width,
            3,
          ]);

          const detections = await this.getDetections(detectionId, input, undefined, detectionSession.minScore);
          if (!detectionSession.running)
            return;
          this.onDeviceEvent(ScryptedInterface.ObjectDetection, detections);

          await sleep(1000);
        }
      }
      finally {
        session.kill();
      }
    })();

    return {
      timestamp: Date.now(),
      detectionId: detectionId,
      running: true,
    };
  }

  endSession(detectionSession: DetectionSession) {
    this.console.log('detection ended', detectionSession.id)
    detectionSession.rebroadcaster?.then(session => session.kill());
    detectionSession.running = false;

    const detections: ObjectsDetected = {
      detectionId: detectionSession.id,
      timestamp: Date.now(),
      running: false,
    };
    this.onDeviceEvent(ScryptedInterface.ObjectDetection, detections)
  }

  async getDetectionModel(): Promise<ObjectDetectionModel> {
    return {
      name: 'Coco SSD',
      classes: this.getAllPeople().map(person => person.name),
      settings: [
        {
          title: 'Minimum Detection Confidence',
          description: 'Higher values eliminate false positives and low quality recognition candidates.',
          key: 'score_threshold',
          type: 'number',
          value: defaultThreshold,
          placeholder: defaultThreshold.toString(),
        }
      ],
    };
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
      },
      {
        title: 'Face Recognition Interval',
        description: 'The interval in milliseconds used to recognize faces when a person is detected.',
        key: 'recognitionInterval',
        type: 'number',
        value: this.recognitionInterval.toString(),
      },
    ]
  }

  async putSetting(key: string, value: string | number | boolean): Promise<void> {
    const vs = value?.toString();
    this.storage.setItem(key, vs);

    if (key === 'recognitionInterval') {
      this.recognitionInterval = parseInt(vs) || defaultRecognitionInterval;
    }
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
}

export default new TensorFlow();
