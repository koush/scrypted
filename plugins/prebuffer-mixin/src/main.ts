
import { MixinProvider, ScryptedDevice, MixinDeviceBase, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, VideoStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { FFMpegFragmentedMP4Session, MP4Atom, startFFMPegFragmetedMP4Session } from '@scrypted/common/src/ffmpeg-mp4-parser-session';
import { Server } from 'net';
import { listenZeroCluster } from '@scrypted/common/src/listen-cluster';
import EventEmitter from 'events';

const { mediaManager, log } = sdk;

const defaultPrebufferDuration = 15000;
const PREBUFFER_DURATION_MS = 'prebufferDuration';

interface Prebuffer {
  atom: MP4Atom;
  time: number;
}

class PrebufferMixin extends MixinDeviceBase<VideoCamera> implements VideoCamera {
  prebufferSession: Promise<FFMpegFragmentedMP4Session>;
  prebufferDurationMs: number;
  prebuffer: Prebuffer[] = [];
  ftyp: MP4Atom;
  moov: MP4Atom;
  events = new EventEmitter();
  released = false;

  constructor(mixinDevice: ScryptedDevice & VideoCamera, deviceState: any, prebufferDuration: number) {
    super(mixinDevice, deviceState);

    this.prebufferDurationMs = prebufferDuration;

    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    log.i(`${this.name} prebuffer session starting in 10 seconds`);
    setTimeout(() => this.ensurePrebufferSession(), 10000);
  }

  ensurePrebufferSession() {
    if (this.prebufferSession || this.released)
      return;
    log.i(`${this.name} prebuffer session started`);
    this.prebufferSession = this.startPrebufferSession();
  }

  async startPrebufferSession() {
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await this.mixinDevice.getVideoStream(), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
    const audioArgs = [
      '-acodec',
      'copy',
    ];

    const videoArgs = [
      '-vcodec',
      'copy',
      '-force_key_frames', `expr:gte(t,n_forced*1})`,
    ];

    const session = await startFFMPegFragmetedMP4Session(ffmpegInput, audioArgs, videoArgs);
    const { cp, socket } = session;
    const cleanup = () => {
      log.i(`${this.name} prebuffer session exited`);
      this.prebufferSession = undefined;
      cp.kill();
      socket.destroy();
    };
    this.startSession(session).finally(cleanup);
    return session;
  }

  async startSession(session: FFMpegFragmentedMP4Session) {
    for await (const atom of session.generator) {
      const now = Date.now();
      if (!this.ftyp) {
        this.ftyp = atom;
      }
      else if (!this.moov) {
        this.moov = atom;
      }
      else {
        this.prebuffer.push({
          atom,
          time: now,
        });
      }


      while (this.prebuffer.length && this.prebuffer[0].time < now - this.prebufferDurationMs) {
        this.prebuffer.shift();
      }

      this.events.emit('atom', atom);
    }
  }

  async getVideoStream(options?: VideoStreamOptions): Promise<MediaObject> {
    if (!options || !options.prebuffer) {
      return this.mixinDevice.getVideoStream(options);
    }

    log.i(`${this.name} prebuffer request started`);

    this.ensurePrebufferSession();
    const server = new Server(socket => {
      server.close();

      const writeAtom = (atom: MP4Atom) => {
        // log.i(`atom ${atom.type} ${atom.length}`);
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
      for (const prebuffer of this.prebuffer) {
        if (prebuffer.time < now - (options?.prebuffer || defaultPrebufferDuration))
          continue;
        if (needMoof && prebuffer.atom.type !== 'moof')
          continue;
        needMoof = false;
        // console.log('writing prebuffer atom', prebuffer.atom);
        writeAtom(prebuffer.atom);
      }

      this.events.on('atom', writeAtom);
      const cleanup = () => {
        log.i(`${this.name} prebuffer request ended`);
        this.events.removeListener('atom', writeAtom);
        socket.removeAllListeners();
      }
      socket.once('end', cleanup);
      socket.once('close', cleanup);
      socket.once('error', cleanup);
    });

    setTimeout(() => server.close(), 30000);

    const port = await listenZeroCluster(server);
    const ffmpegInput: FFMpegInput = {
      inputArguments: [
        '-f',
        'mp4',
        '-i',
        `tcp://127.0.0.1:${port}`,
      ],
    }

    console.log(ffmpegInput.inputArguments[3]);
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
    first.prebuffer = this.prebufferDurationMs;
    return ret;
  }

  release() {
    log.i(`${this.name} prebuffer releasing if started`);
    this.released = true;
    this.prebufferSession?.then(start => {
      log.i(`${this.name} prebuffer released`);
      start.cp.kill();
      start.socket.destroy();
    });
  }
}

class PrebufferProvider extends ScryptedDeviceBase implements MixinProvider, Settings {
  canMixin(type: ScryptedDeviceType, interfaces: string[]): string[] {
    if (!interfaces.includes(ScryptedInterface.VideoCamera))
      return null;
    return [ScryptedInterface.VideoCamera];
  }

  getMixin(device: ScryptedDevice, deviceState: any) {
    return new PrebufferMixin(device as ScryptedDevice & VideoCamera, deviceState, parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration);
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Prebuffer Size',
        description: 'Duration of the prebuffer in milliseconds.',
        type: 'number',
        key: PREBUFFER_DURATION_MS,
        value: this.storage.getItem(PREBUFFER_DURATION_MS) || defaultPrebufferDuration.toString(),
      }
    ]
  }
  async putSetting(key: string, value: string | number | boolean) {
    this.storage.setItem(key, value.toString());
  }
}

export default new PrebufferProvider();
