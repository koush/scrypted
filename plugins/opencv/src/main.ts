
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput, MotionSensor } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { Server } from 'net';
import { listenZeroCluster } from '@scrypted/common/src/listen-cluster';
import EventEmitter from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { probeVideoCamera } from '@scrypted/common/src/media-helpers';
import { createMpegTsParser, createFragmentedMp4Parser, MP4Atom, StreamChunk } from '@scrypted/common/src/stream-parser';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import cv, { Mat, Size } from "@koush/opencv4nodejs";

const { mediaManager, log, systemManager, deviceManager } = sdk;

const defaultArea = 2000;

class OpenCVMixin extends SettingsMixinDeviceBase<VideoCamera> implements MotionSensor, Settings {
  area: number;

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group: "OpenCV Settings",
      groupKey: "opencv",
    });

    this.area = parseInt(localStorage.getItem('area')) || defaultArea;
    if (this.mixinDevice.providedInterfaces.includes(ScryptedInterface.MotionSensor)) {
      log.a(`${this.name} has a built in MotionSensor. OpenCV motion processing cancelled. Pleaes disable this extension.`);
      return;
    }
    this.start();
  }

  async start() {
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await this.mixinDevice.getVideoStream(), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
    const inputFlag = ffmpegInput.inputArguments.indexOf('-i');
    if (!inputFlag) {
      throw new Error('flag -i not found');
    }

    const inputUrl = ffmpegInput.inputArguments[inputFlag + 1];
    const cap = new cv.VideoCapture(inputUrl);
    let previousFrame: Mat;
    let lastFrameProcessed = 0;

    let timeout: NodeJS.Timeout;
    const triggerMotion = () => {
      this.motionDetected = true;
      clearTimeout(timeout);
      setTimeout(() => this.motionDetected = false, 10000);
    }
    this.motionDetected = false;
    while (true) {
      let mat = await cap.readAsync();

      if (this.motionDetected) {
        // during motion just eat the frames.
        previousFrame = undefined;
        continue;
      }

      // limit processing to 2fps
      const now = Date.now()
      if (lastFrameProcessed > now - 500)
        continue;
      lastFrameProcessed = now;

      if (mat.cols > 1920 / 4) {
        const cols = 1920 / 4;
        const rows = Math.round(mat.rows / mat.cols * (1920 / 4));
        mat = await mat.resizeAsync(rows, cols);
      }
      const gray = await mat.cvtColorAsync(cv.COLOR_BGR2GRAY);
      const curFrame = await gray.gaussianBlurAsync(new Size(21, 21), 0);

      try {
        if (!previousFrame) {
          continue;
        }

        const frameDelta = previousFrame.absdiff(curFrame);
        let thresh = await frameDelta.thresholdAsync(25, 255, cv.THRESH_BINARY);
        const dilated = await thresh.dilateAsync(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(4, 4)), new cv.Point2(-1, -1), 2)
        const dilatedCopy = await dilated.copyAsync();
        const contours = await dilatedCopy.findContoursAsync(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const filteredContours = contours.filter(cnt => cnt.area > this.area).map(cnt => cnt.area);
        if (filteredContours.length) {
          console.log(this.name, 'motion triggered by area(s)', filteredContours.join(','));
          triggerMotion();
        }
      }
      finally {
        previousFrame = curFrame;
      }
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    return [
      {
        title: "Motion Area Threshold",
        description: "The area size required to trigger motion. Higher values (larger areas) are less sensitive.",
        value: this.storage.getItem('area') || defaultArea.toString(),
        key: 'area',
        placeholder: defaultArea.toString(),
        type: 'number',
      }
    ];
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    this.storage.setItem(key, value.toString());
    if (key === 'area')
      this.area = parseInt(value.toString()) || defaultArea;
  }

  release() {
  }
}

class OpenCVProvider extends AutoenableMixinProvider implements MixinProvider {
  constructor(nativeId?: string) {
    super(nativeId);
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.MotionSensor))
      return null;
    return [ScryptedInterface.MotionSensor, ScryptedInterface.Settings];
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    this.setHasEnabledMixin(mixinDeviceState.id);
    return new OpenCVMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new OpenCVProvider();
