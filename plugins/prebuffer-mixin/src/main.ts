
import { MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { Server } from 'net';
import { listenZeroCluster } from '@scrypted/common/src/listen-cluster';
import EventEmitter from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { probeVideoCamera } from '@scrypted/common/src/media-helpers';
import { createMpegTsParser, createFragmentedMp4Parser, MP4Atom, StreamChunk } from '@scrypted/common/src/stream-parser';

const { mediaManager, log } = sdk;

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

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group: "Rebroadcast and Prebuffer Settings",
      groupKey: "prebuffer",
    });

    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    console.log(`${this.name} prebuffer session starting in 10 seconds`);
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
        title: 'Detected Video Codec',
        readonly: true,
        key: 'detectedVcodec',
        value: this.session?.inputVideoCodec.toString() || 'none',
      },
      {
        group: 'Media Information',
        title: 'Detected Audio Codec',
        readonly: true,
        key: 'detectedAcodec',
        value: this.session?.inputAudioCodec.toString() || 'none',
      },
      {
        group: 'Media Information',
        title: 'Detected Keyframe Interval',
        description: "Currently detected keyframe interval. This value may vary based on the stream behavior.",
        readonly: true,
        key: 'detectedIdr',
        value: this.detectedIdrInterval.toString() || 'none',
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
    console.log(`${this.name} prebuffer session started`);
    this.prebufferSession = this.startPrebufferSession();
  }

  async startPrebufferSession() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    const prebufferDurationMs = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await this.mixinDevice.getVideoStream(), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

    const reencodeAudio = this.storage.getItem(REENCODE_AUDIO) === 'true';

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
      console.warn(this.name, 'no audio detected.');
    }
    else if (this.session.inputAudioCodec !== 'aac') {
      console.error(this.name, 'Detected audio codec was not AAC.');
      if (this.name?.indexOf('pcm') !== -1 && !reencodeAudio) {
        log.a(`${this.name} is using PCM audio. You will need to enable Reencode Audio in Rebroadcast Settings for this stream.`);
      }
    }

    if (this.session.inputVideoCodec !== 'h264') {
      console.error(`${this.name} video codec is not h264. If there are errors, try changing your camera's encoder output.`);
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
      console.log(this.name, 'rebroadcast session cant be used here', options);
      return this.mixinDevice.getVideoStream(options);
    }

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) !== 'false';
    if (!options?.prebuffer && !sendKeyframe) {
      const mo = mediaManager.createFFmpegMediaObject(session.ffmpegInputs['mpegts']);
      return mo;
    }

    console.log(this.name, 'prebuffer request started');

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
        console.log(this.name, 'prebuffer request ended');
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

    const ffmpegInput: FFMpegInput = {
      inputArguments: [
        '-f', container,
        '-i', `tcp://127.0.0.1:${port}`,
      ],
      mediaStreamOptions,
    }

    console.log(this.name, 'prebuffer ffmpeg input', ffmpegInput.inputArguments[3]);
    const mo = mediaManager.createFFmpegMediaObject(ffmpegInput);
    return mo;
  }

  async getVideoStreamOptions(): Promise<void | MediaStreamOptions[]> {
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
    console.log(this.name, 'prebuffer releasing if started');
    this.released = true;
    this.prebufferSession?.then(start => {
      console.log(this.name, 'prebuffer released');
      start.kill();
    });
  }
}

class PrebufferProvider extends ScryptedDeviceBase implements MixinProvider {
  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.VideoCamera))
      return null;
    return [ScryptedInterface.VideoCamera, ScryptedInterface.Settings];
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    return new PrebufferMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new PrebufferProvider();
