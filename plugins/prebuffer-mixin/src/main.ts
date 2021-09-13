
import { MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, VideoStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { createServer, Server, Socket } from 'net';
import { listenZeroCluster } from '@scrypted/common/src/listen-cluster';
import EventEmitter from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { MP4Atom, parseFragmentedMP4 } from '@scrypted/common/src/ffmpeg-mp4-parser-session';

const { mediaManager } = sdk;

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
  idrInterval = 0;
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
        title: 'Detected Keyframe Interval',
        description: "Currently detected keyframe interval. This value may vary based on the stream behavior.",
        readonly: true,
        key: 'detectedIdr',
        value: this.idrInterval.toString(),
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
      }
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

    const acodec = reencodeAudio ? [] : [
      '-acodec',
      'copy',
    ];

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
              this.idrInterval = now - this.prevIdr;
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
      fragmentClientHandler(socket).catch(e => console.log('fragmented mp4 session ended', e));
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

  async getVideoStream(options?: VideoStreamOptions): Promise<MediaObject> {
    this.ensurePrebufferSession();

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) === 'true';

    if (!options?.prebuffer && !sendKeyframe) {
      const session = await this.prebufferSession;
      const mo = mediaManager.createFFmpegMediaObject(session.ffmpegInput);
      return mo;
    }

    const requestedPrebuffer = options?.prebuffer || (sendKeyframe ? (this.idrInterval || 4000) + 1000 : 0);

    console.log(this.name, 'prebuffer request started');

    const server = new Server(socket => {
      server.close();

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

    const ffmpegInput: FFMpegInput = {
      inputArguments: [
        '-f', options?.container === 'mp4' ? 'mp4' : 'mpegts',
        '-i', `tcp://127.0.0.1:${port}`,
      ],
    }

    console.log(this.name, 'prebuffer ffmpeg input', ffmpegInput.inputArguments[3]);
    const mo = mediaManager.createFFmpegMediaObject(ffmpegInput);
    return mo;
  }

  async getVideoStreamOptions(): Promise<void | VideoStreamOptions[]> {
    const ret: VideoStreamOptions[] = await this.mixinDevice.getVideoStreamOptions() || [];
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
