
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { Server } from 'net';
import { listenZeroCluster } from '@scrypted/common/src/listen-cluster';
import EventEmitter from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { probeVideoCamera } from '@scrypted/common/src/media-helpers';
import { createMpegTsParser, createFragmentedMp4Parser, MP4Atom, StreamChunk } from '@scrypted/common/src/stream-parser';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';

const { mediaManager, log, systemManager, deviceManager } = sdk;

const defaultPrebufferDuration = 15000;
const PREBUFFER_DURATION_MS = 'prebufferDuration';
const SEND_KEYFRAME = 'sendKeyframe';
const REENCODE_AUDIO = 'reencodeAudio';
const REENCODE_VIDEO = 'reencodeVideo';

interface PrebufferStreamChunk {
  chunk: StreamChunk;
  time: number;
}

class PrebufferMixin extends SettingsMixinDeviceBase<VideoCamera> implements VideoCamera, Settings {
  prebufferSession: Promise<FFMpegRebroadcastSession>;
  prebuffers = {
    mp4: [],
    mpegts: [],
  };
  events = new EventEmitter();
  released = false;
  ftyp: MP4Atom;
  moov: MP4Atom;
  session: FFMpegRebroadcastSession;
  detectedIdrInterval = 0;
  prevIdr = 0;
  unexpectedPCM = false;

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group: "Rebroadcast and Prebuffer Settings",
      groupKey: "prebuffer",
    });

    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    this.console.log(`prebuffer session starting in 10 seconds`);
    setTimeout(() => this.ensurePrebufferSession(), 10000);
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    settings.push(
      {
        title: 'Prebuffer Duration',
        description: 'Duration of the prebuffer in milliseconds.',
        type: 'number',
        key: PREBUFFER_DURATION_MS,
        value: this.storage.getItem(PREBUFFER_DURATION_MS) || defaultPrebufferDuration.toString(),
      },
      {
        title: 'Start at Previous Keyframe',
        description: 'Start live streams from the previous key frame. Improves startup time.',
        type: 'boolean',
        key: SEND_KEYFRAME,
        value: (this.storage.getItem(SEND_KEYFRAME) !== 'false').toString(),
      },
      {
        title: 'Reencode Audio',
        description: 'Reencode the audio (necessary if camera outputs PCM).',
        type: 'boolean',
        key: REENCODE_AUDIO,
        value: (this.storage.getItem(REENCODE_AUDIO) === 'true').toString(),
      },
      {
        group: 'Media Information',
        title: 'Detected Resolution',
        readonly: true,
        key: 'detectedAcodec',
        value: `${this.session?.inputVideoResolution?.[0] || "unknown"}`
      },
      {
        group: 'Media Information',
        title: 'Detected Video/Audio Codecs',
        readonly: true,
        key: 'detectedVcodec',
        value: (this.session?.inputVideoCodec?.toString() || 'unknown') + '/' + (this.session?.inputAudioCodec?.toString() || 'unknown'),
      },
      {
        group: 'Media Information',
        title: 'Detected Keyframe Interval',
        description: "Currently detected keyframe interval. This value may vary based on the stream behavior.",
        readonly: true,
        key: 'detectedIdr',
        value: this.detectedIdrInterval?.toString() || 'none',
      },
    );
    return settings;
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    this.storage.setItem(key, value.toString());
    this.prebufferSession?.then(session => session.kill());
  }

  ensurePrebufferSession() {
    if (this.prebufferSession || this.released)
      return;
    console.log(`prebuffer session started`);
    this.prebufferSession = this.startPrebufferSession();
  }

  async startPrebufferSession() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    const prebufferDurationMs = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await this.mixinDevice.getVideoStream(), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

    const reencodeAudio = this.storage.getItem(REENCODE_AUDIO) === 'true' || this.unexpectedPCM;

    const probe = await probeVideoCamera(this.mixinDevice);

    let acodec: string[];
    // no audio? explicitly disable it.
    if (probe.noAudio) {
      acodec = ['-an'];
    }
    else {
      acodec = reencodeAudio ? [] : [
        '-acodec',
        'copy',
      ];
    }

    const vcodec = [
      '-vcodec',
      'copy',
    ];

    const session = await startRebroadcastSession(ffmpegInput, {
      console: this.console,
      parsers: {
        mp4: createFragmentedMp4Parser({
          vcodec,
          acodec,
        }),
        mpegts: createMpegTsParser({
          vcodec,
          acodec,
        }),
      }
    });

    this.session = session;

    if (!this.session.inputAudioCodec) {
      this.console.warn('no audio detected.');
    }
    else if (this.session.inputAudioCodec !== 'aac') {
      this.console.error('Detected audio codec was not AAC.');
      if (!probe.noAudio && session.inputAudioCodec && session.inputAudioCodec.indexOf('pcm') !== -1 && !reencodeAudio) {
        log.a(`${this.name} is using PCM audio and will be reencoded. Enable Reencode Audio in Rebroadcast Settings to disable this alert.`);
        this.unexpectedPCM = true;
      }
    }

    if (this.session.inputVideoCodec !== 'h264') {
      this.console.error(`video codec is not h264. If there are errors, try changing your camera's encoder output.`);
    }

    session.events.on('killed', () => {
      this.prebufferSession = undefined;
    });

    for (const container of ['mpegts', 'mp4']) {
      const eventName = container + '-data';
      const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];

      session.events.on(eventName, (chunk: StreamChunk) => {
        const now = Date.now();

        if (chunk.type === 'mdat') {
          if (this.prevIdr)
            this.detectedIdrInterval = now - this.prevIdr;
          this.prevIdr = now;
        }

        prebufferContainer.push({
          time: now,
          chunk,
        });

        while (prebufferContainer.length && prebufferContainer[0].time < now - prebufferDurationMs) {
          prebufferContainer.shift();
        }

        this.events.emit(eventName, chunk);
      });
    }

    return session;
  }

  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    this.ensurePrebufferSession();

    const session = await this.prebufferSession;

    // if a specific stream is requested, and it's not what we're streaming, just fall through to source.
    if (options?.id && options.id !== session.ffmpegInputs['mpegts'].mediaStreamOptions?.id) {
      this.console.log('rebroadcast session cant be used here', options);
      return this.mixinDevice.getVideoStream(options);
    }

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) !== 'false';
    if (!options?.prebuffer && !sendKeyframe) {
      const mo = mediaManager.createFFmpegMediaObject(session.ffmpegInputs['mpegts']);
      return mo;
    }

    this.console.log('prebuffer request started');

    const container = options?.container || 'mpegts';
    const eventName = container + '-data';
    const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];

    const server = new Server(socket => {
      server.close();
      const requestedPrebuffer = options?.prebuffer || (sendKeyframe ? Math.max(4000, (this.detectedIdrInterval || 4000)) * 1.5 : 0);

      const now = Date.now();

      let cleanup: () => void;

      let first = true;
      const writeData = (data: StreamChunk) => {
        if (first) {
          first = false;
          if (data.startStream) {
            socket.write(data.startStream)
          }
        }
        socket.write(data.chunk);
      };

      for (const prebuffer of prebufferContainer) {
        if (prebuffer.time < now - requestedPrebuffer)
          continue;

        writeData(prebuffer.chunk);
      }

      this.events.on(eventName, writeData);
      cleanup = () => {
        this.console.log('prebuffer request ended');
        this.events.removeListener(eventName, writeData);
        this.events.removeListener('killed', cleanup);
        socket.removeAllListeners();
        socket.destroy();
      }

      this.events.once('killed', cleanup);
      socket.once('end', cleanup);
      socket.once('close', cleanup);
      socket.once('error', cleanup);
    });

    setTimeout(() => server.close(), 30000);

    const port = await listenZeroCluster(server);

    const mediaStreamOptions = session.ffmpegInputs[container].mediaStreamOptions
      ? Object.assign({}, session.ffmpegInputs[container].mediaStreamOptions)
      : undefined;

    if (mediaStreamOptions && mediaStreamOptions.audio) {
      const reencodeAudio = this.storage.getItem(REENCODE_AUDIO) === 'true';
      if (reencodeAudio)
        mediaStreamOptions.audio = {
          codec: 'aac',
        }
    }

    if (mediaStreamOptions.video) {
      Object.assign(mediaStreamOptions.video, {
        width: parseInt(this.session.inputVideoResolution[2]),
        height: parseInt(this.session.inputVideoResolution[3]),
      })
    }

    const ffmpegInput: FFMpegInput = {
      inputArguments: [
        '-f', container,
        '-i', `tcp://127.0.0.1:${port}`,
      ],
      mediaStreamOptions,
    }

    this.console.log('prebuffer ffmpeg input', ffmpegInput.inputArguments[3]);
    const mo = mediaManager.createFFmpegMediaObject(ffmpegInput);
    return mo;
  }

  async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
    const ret: MediaStreamOptions[] = await this.mixinDevice.getVideoStreamOptions() || [];
    let first = ret[0];
    if (!first) {
      first = {};
      ret.push(first);
    }
    first.prebuffer = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;
    return ret;
  }

  release() {
    this.console.log('prebuffer releasing if started');
    this.released = true;
    this.prebufferSession?.then(start => {
      this.console.log('prebuffer released');
      start.kill();
    });
  }
}

function millisUntilMidnight() {
  var midnight = new Date();
  midnight.setHours(24);
  midnight.setMinutes(0);
  midnight.setSeconds(0);
  midnight.setMilliseconds(0);
  return (midnight.getTime() - new Date().getTime());
}

class PrebufferProvider extends AutoenableMixinProvider implements MixinProvider {
  constructor(nativeId?: string) {
    super(nativeId);

    // trigger the prebuffer.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.getVideoStreamOptions();
    }

    // schedule restarts at 2am
    const midnight = millisUntilMidnight();
    const twoAM = midnight + 2 * 60 * 60 * 1000;
    this.log.i(`Rebroadcaster scheduled for restart at 2AM: ${Math.round(twoAM / 1000 / 60)} minutes`)
    setTimeout(() => deviceManager.requestRestart(), twoAM);
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.VideoCamera))
      return null;
    return [ScryptedInterface.VideoCamera, ScryptedInterface.Settings];
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    this.setHasEnabledMixin(mixinDeviceState.id);
    return new PrebufferMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new PrebufferProvider();
