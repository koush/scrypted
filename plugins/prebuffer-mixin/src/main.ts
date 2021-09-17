
import { MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { createServer, Server, Socket } from 'net';
import { listenZeroCluster } from '@scrypted/common/src/listen-cluster';
import EventEmitter from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { probeVideoCamera } from '@scrypted/common/src/media-helpers';
import { MP4Atom, parseFragmentedMP4 } from '@scrypted/common/src/ffmpeg-mp4-parser-session';

const { mediaManager, log } = sdk;

const defaultPrebufferDuration = 15000;
const PREBUFFER_DURATION_MS = 'prebufferDuration';
const SEND_KEYFRAME = 'sendKeyframe';
const REENCODE_AUDIO = 'reencodeAudio';
const REENCODE_VIDEO = 'reencodeVideo';

interface PrebufferMpegTs {
  buffer: Buffer;
  time: number;
}

interface PrebufferFmp4 {
  atom: MP4Atom;
  time: number;
}


class PrebufferMixin extends SettingsMixinDeviceBase<VideoCamera> implements VideoCamera, Settings {
  prebufferSession: Promise<FFMpegRebroadcastSession>;
  prebufferMpegTs: PrebufferMpegTs[] = [];
  prebufferFmp4: PrebufferFmp4[] = [];
  events = new EventEmitter();
  released = false;
  ftyp: MP4Atom;
  moov: MP4Atom;
  detectedIdrInterval = 0;
  detectedVcodec = '';
  detectedAcodec = '';
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
        value: (this.storage.getItem(SEND_KEYFRAME) === 'true').toString(),
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
        value: this.detectedVcodec.toString() || 'none',
      },
      {
        group: 'Media Information',
        title: 'Detected Audio Codec',
        readonly: true,
        key: 'detectedAcodec',
        value: this.detectedAcodec.toString() || 'none',
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
    this.prebufferMpegTs = [];
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

    const fragmentClientHandler = async (socket: Socket) => {
      fmp4OutputServer.close();
      const parser = parseFragmentedMP4(socket);
      for await (const atom of parser) {
        const now = Date.now();
        if (!this.ftyp) {
          this.ftyp = atom;
        }
        else if (!this.moov) {
          this.moov = atom;
        }
        else {
          if (atom.type === 'mdat') {
            if (this.prevIdr)
              this.detectedIdrInterval = now - this.prevIdr;
            this.prevIdr = now;
          }

          this.prebufferFmp4.push({
            atom,
            time: now,
          });
        }

        while (this.prebufferFmp4.length && this.prebufferFmp4[0].time < now - prebufferDurationMs) {
          this.prebufferFmp4.shift();
        }

        this.events.emit('atom', atom);
      }
    }

    const fmp4OutputServer = createServer(socket => {
      fragmentClientHandler(socket).catch(e => console.log(this.name, 'fragmented mp4 session ended', e));
    });
    const fmp4Port = await listenZeroCluster(fmp4OutputServer);

    const additionalOutputs = [
      '-f', 'mp4',
      ...acodec,
      ...vcodec,
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      `tcp://127.0.0.1:${fmp4Port}`
    ];

    const session = await startRebroadcastSession(ffmpegInput, {
      additionalOutputs,
      vcodec,
      acodec,
    });

    this.detectedAcodec = session.inputAudioCodec || '';
    this.detectedVcodec = session.inputVideoCodec || '';

    if (!this.detectedAcodec) {
      console.warn(this.name, 'no audio detected.');
    }
    else if (this.detectedAcodec !== 'aac') {
      console.error(this.name, 'Detected audio codec was not AAC.');
      if (this.name?.indexOf('pcm') !== -1 && !reencodeAudio) {
        log.a(`${this.name} is using PCM audio. You will need to enable Reencode Audio in Rebroadcast Settings for this stream.`);
      }
    }

    if (this.detectedVcodec !== 'h264') {
      console.error(`${this.name} video codec is not h264. If there are errors, try changing your camera's encoder output.`);
    }

    session.events.on('killed', () => {
      fmp4OutputServer.close();
      this.prebufferSession = undefined;
    });
    session.events.on('data', (data: Buffer) => {
      const now = Date.now();
      this.prebufferMpegTs.push({
        time: now,
        buffer: data,
      });

      while (this.prebufferMpegTs.length && this.prebufferMpegTs[0].time < now - prebufferDurationMs) {
        this.prebufferMpegTs.shift();
      }

      this.events.emit('mpegts-data', data);
    });
    return session;
  }

  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    this.ensurePrebufferSession();

    const session = await this.prebufferSession;

    // if a specific stream is requested, and it's not what we're streaming, just fall through to source.
    if (options?.id && options.id !== session.ffmpegInput.mediaStreamOptions?.id) {
      console.log(this.name, 'rebroadcast session cant be used here', options);
      return this.mixinDevice.getVideoStream(options);
    }

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) === 'true';
    if (!options?.prebuffer && !sendKeyframe) {
      const mo = mediaManager.createFFmpegMediaObject(session.ffmpegInput);
      return mo;
    }

    console.log(this.name, 'prebuffer request started');

    const server = new Server(socket => {
      server.close();
      const requestedPrebuffer = options?.prebuffer || (sendKeyframe ? Math.max(4000, (this.detectedIdrInterval || 4000)) * 1.5 : 0);

      const now = Date.now();

      let cleanup: () => void;

      if (options?.container === 'mp4') {
        const writeAtom = (atom: MP4Atom) => {
          socket.write(Buffer.concat([atom.header, atom.data]));
        };

        if (this.ftyp) {
          writeAtom(this.ftyp);
        }
        if (this.moov) {
          writeAtom(this.moov);
        }
        const now = Date.now();
        let needMoof = true;
        for (const prebuffer of this.prebufferFmp4) {
          if (prebuffer.time < now - requestedPrebuffer)
            continue;
          if (needMoof && prebuffer.atom.type !== 'moof')
            continue;
          needMoof = false;
          // console.log('writing prebuffer atom', prebuffer.atom);
          writeAtom(prebuffer.atom);
        }

        this.events.on('atom', writeAtom);
        cleanup = () => {
          console.log(this.name, 'prebuffer request ended');
          this.events.removeListener('atom', writeAtom);
          this.events.removeListener('killed', cleanup);
          socket.removeAllListeners();
          socket.destroy();
        }

      }
      else {
        const writeData = (data: Buffer) => {
          socket.write(data);
        };

        for (const prebuffer of this.prebufferMpegTs) {
          if (prebuffer.time < now - requestedPrebuffer)
            continue;
          writeData(prebuffer.buffer);
        }

        this.events.on('mpegts-data', writeData);
        cleanup = () => {
          console.log(this.name, 'prebuffer request ended');
          this.events.removeListener('mpegts-data', writeData);
          this.events.removeListener('killed', cleanup);
          socket.removeAllListeners();
          socket.destroy();
        }
      }

      this.events.once('killed', cleanup);
      socket.once('end', cleanup);
      socket.once('close', cleanup);
      socket.once('error', cleanup);
    });

    setTimeout(() => server.close(), 30000);

    const port = await listenZeroCluster(server);

    const mediaStreamOptions = session.ffmpegInput.mediaStreamOptions
      ? Object.assign({}, session.ffmpegInput.mediaStreamOptions)
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
        '-f', options?.container === 'mp4' ? 'mp4' : 'mpegts',
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
