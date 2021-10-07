
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, EventListenerRegister, ObjectDetector } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
const tf = __non_webpack_require__('@tensorflow/tfjs-node-gpu');
const coco = __non_webpack_require__('@tensorflow-models/coco-ssd');
import jpeg from 'jpeg-js';
import fs from 'fs';
import fetch from 'node-fetch';
const { ENV}  = __non_webpack_require__( '@tensorflow/tfjs-core');

ENV.global.fetch = fetch as any;
console.log(tf.getBackend());

const ssdPromise = coco.load();
ssdPromise.catch(e => console.error('load error', e));

const { mediaManager, log, systemManager, deviceManager } = sdk;

const imageToInput = (buf: Buffer, numChannels: number) => {
  const image = jpeg.decode(buf)
  const pixels = image.data
  const numPixels = image.width * image.height;
  const values = new Int32Array(numPixels * numChannels);

  for (let i = 0; i < numPixels; i++) {
      for (let channel = 0; channel < numChannels; ++channel) {
          values[i * numChannels + channel] = pixels[i * 4 + channel];
      }
  }

  const outShape: [number, number, number] = [image.height, image.width, numChannels];
  const input = tf.tensor3d(values, outShape, 'int32');

  return input
}


class TensorFlowMixin extends SettingsMixinDeviceBase<VideoCamera> implements ObjectDetector, Settings {
  released = false;
  register: EventListenerRegister;

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group: "TensorFlow Settings",
      groupKey: "tensorflow",
    });

    const realDevice = systemManager.getDeviceById<Camera & VideoCamera>(this.id);
    this.register = realDevice.listen(ScryptedInterface.MotionSensor, async (eventSource, eventDetails, eventData) => {
      const video = await realDevice.takePicture();
      const buffer = await mediaManager.convertMediaObjectToBuffer(video, 'image/jpeg');
      const input = imageToInput(buffer, 3);

      const ssd = await ssdPromise;
      const detections = await ssd.detect(input);
      this.console.log('Detections:', detections);
    })
  }

  getDetectionInput(detectionId: any): Promise<MediaObject> {
    throw new Error('Method not implemented.');
  }

  async getMixinSettings(): Promise<Setting[]> {
    return [
    ];
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
  }

  release() {
    this.released = true;
    this.register.removeListener();
  }
}

class TensorFlow extends AutoenableMixinProvider implements MixinProvider {
  constructor(nativeId?: string) {
    super(nativeId);

    // trigger trigger tensorflow.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera & Settings>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.getSettings();
    }
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if ((interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.Camera))
      && interfaces.includes(ScryptedInterface.MotionSensor)) {
      return [ScryptedInterface.ObjectDetector];
    }
    return null;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    this.setHasEnabledMixin(mixinDeviceState.id);
    return new TensorFlowMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new TensorFlow();
