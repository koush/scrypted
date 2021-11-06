
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput, MotionSensor } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { once } from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { StreamChunk, createRawVideoParser } from '@scrypted/common/src/stream-parser';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import cv, { Mat, Size } from "@koush/opencv4nodejs";

const { mediaManager, log, systemManager, deviceManager } = sdk;

const defaultInterval = 10;
const defaultArea = 2000;
const defaultThreshold = 25;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class OpenCVMixin extends SettingsMixinDeviceBase<VideoCamera> implements MotionSensor, Settings {
  area: number;
  threshold: number;
  released = false;
  sessionPromise: Promise<FFMpegRebroadcastSession>;

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group: "OpenCV Settings",
      groupKey: "opencv",
    });

    this.area = parseInt(localStorage.getItem('area')) || defaultArea;
    this.threshold = parseInt(localStorage.getItem('threshold')) || defaultThreshold;
    if (this.providedInterfaces.includes(ScryptedInterface.MotionSensor)) {
      log.a(`${this.name} has a built in MotionSensor. OpenCV motion processing cancelled. Pleaes disable this extension.`);
      return;
    }

    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    this.console.log('session starting in 5 seconds');
    setTimeout(async () => {
      while (!this.released) {
        try {
          await this.start();
          this.console.log('shut down gracefully');
        }
        catch (e) {
          this.console.error(this.name, 'session unexpectedly terminated, restarting in 5 seconds', e);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }, 5000);
  }

  async start() {
    const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);

    let selectedStream: MediaStreamOptions;
    const motionChannel = this.storage.getItem('motionChannel');
    if (motionChannel) {
      const msos = await realDevice.getVideoStreamOptions();
      selectedStream = msos.find(mso => mso.name === motionChannel);
    }

    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await realDevice.getVideoStream(selectedStream), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
    let video = ffmpegInput.mediaStreamOptions?.video;
    if (!video?.width || !video?.height) {
      this.console.error("Width and Height were not provided. Defaulting to 1920x1080.");
      video = {
        width: 1920,
        height: 1080,
      };
    }

    let { width, height } = video;
    // we'll use an image 1/6 of the dimension in size for motion.
    // however, opencv also expects that input images are modulo 6.
    // so make sure both are satisfied.

    if (width > height) {
      if (width > 318) {
        height = height / width * 318;
        width = 318;
      }
    }
    else {
      if (height > 318) {
        width = width / height * 318;
        height = 318;
      }
    }

    // square em up
    width = Math.floor(width / 6) * 6;
    height = Math.floor(height / 6) * 6;

    this.sessionPromise = startRebroadcastSession(ffmpegInput, {
      console: this.console,
      parsers: {
        rawvideo: createRawVideoParser({
          size: {
            width,
            height,
          },
          everyNFrames: parseInt(this.storage.getItem('interval')) || 10,
        }),
      }
    });

    const session = await this.sessionPromise;

    let watchdog: NodeJS.Timeout;
    const restartWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        this.console.error('watchdog for raw video parser timed out... killing ffmpeg session');
        session.kill();
      }, 60000);
    }
    session.events.on('rawvideo-data', restartWatchdog);

    session.events.once('killed', () => {
      clearTimeout(watchdog);
    });

    restartWatchdog();

    try {
      await this.startWrapped(session);
    }
    finally {
      session.kill();
    }
  }

  async startWrapped(session: FFMpegRebroadcastSession) {
    let previousFrame: Mat;
    let timeout: NodeJS.Timeout;

    const triggerMotion = () => {
      this.motionDetected = true;
      clearTimeout(timeout);
      setTimeout(() => this.motionDetected = false, 10000);
    }

    this.motionDetected = false;

    while (!this.released) {
      if (this.motionDetected) {
        // during motion just eat the frames.
        previousFrame = undefined;
        await sleep(1000);
        continue;
      }

      const args = await once(session.events, 'rawvideo-data');
      const chunk: StreamChunk = args[0];
      // should be one chunk from the parser, but let's not assume that.
      const raw = chunk.chunks.length === 1 ? chunk.chunks[0] : Buffer.concat(chunk.chunks);
      const mat = new Mat(raw, chunk.height * 3 / 2, chunk.width, cv.CV_8U);

      const gray = await mat.cvtColorAsync(cv.COLOR_YUV420p2GRAY);
      const curFrame = await gray.gaussianBlurAsync(new Size(21, 21), 0);

      try {
        if (!previousFrame) {
          continue;
        }

        const frameDelta = previousFrame.absdiff(curFrame);
        const thresh = await frameDelta.thresholdAsync(this.threshold, 255, cv.THRESH_BINARY);
        const dilated = await thresh.dilateAsync(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(4, 4)), new cv.Point2(-1, -1), 2)
        const contours = await dilated.findContoursAsync(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const filteredContours = contours.filter(cnt => cnt.area > this.area).map(cnt => cnt.area);
        if (filteredContours.length) {
          this.console.log('motion triggered by area(s)', filteredContours.join(','));
          triggerMotion();
        }
      }
      finally {
        previousFrame = curFrame;
      }
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];
    const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);

    let msos: MediaStreamOptions[] = [];
    try {
      msos = await realDevice.getVideoStreamOptions();
    }
    catch (e) {
    }


    if (msos?.length) {
      settings.push({
        title: 'Motion Stream',
        key: 'motionChannel',
        value: this.storage.getItem('motionChannel') || msos[0].name,
        description: 'The stream to use for detecting motion. Using the lowest resolution stream is recommended.',
        choices: msos.map(mso => mso.name),
      });
    }

    settings.push(
      {
        title: "Motion Area",
        description: "The area size required to trigger motion. Higher values (larger areas) are less sensitive.",
        value: this.storage.getItem('area') || defaultArea.toString(),
        key: 'area',
        placeholder: defaultArea.toString(),
        type: 'number',
      },
      {
        title: "Motion Threshold",
        description: "The threshold required to consider a pixel changed. Higher values (larger changes) are less sensitive.",
        value: this.storage.getItem('threshold') || defaultThreshold.toString(),
        key: 'threshold',
        placeholder: defaultThreshold.toString(),
        type: 'number',
      },
      {
        title: "Frame Analysis Interval",
        description: "The number of frames to wait between motion analysis.",
        value: this.storage.getItem('interval') || defaultInterval.toString(),
        key: 'interval',
        placeholder: defaultInterval.toString(),
        type: 'number',
      },
    );

    return settings;
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    this.storage.setItem(key, value.toString());
    if (key === 'area')
      this.area = parseInt(value.toString()) || defaultArea;
    if (key === 'threshold')
      this.threshold = parseInt(value.toString()) || defaultThreshold;

    if (key === 'motionChannel') {
      this.sessionPromise?.then(session => session.kill());
    }
  }

  release() {
    this.released = true;
  }
}

class OpenCVProvider extends AutoenableMixinProvider implements MixinProvider {
  constructor(nativeId?: string) {
    super(nativeId);

    // trigger opencv.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.getVideoStreamOptions();
    }

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
