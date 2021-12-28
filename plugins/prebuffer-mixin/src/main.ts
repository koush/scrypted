
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import EventEmitter, { once } from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { createRebroadcaster, FFMpegRebroadcastOptions, FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { probeVideoCamera } from '@scrypted/common/src/media-helpers';
import { createMpegTsParser, createFragmentedMp4Parser, StreamChunk, createPCMParser, StreamParser } from '@scrypted/common/src/stream-parser';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';

const { mediaManager, log, systemManager, deviceManager } = sdk;

const defaultPrebufferDuration = 10000;
const PREBUFFER_DURATION_MS = 'prebufferDuration';
const SEND_KEYFRAME = 'sendKeyframe';
const AUDIO_CONFIGURATION_TEMPLATE = 'audioConfiguration';
const DEFAULT_AUDIO = 'Default';
const COMPATIBLE_AUDIO = 'AAC or No Audio';
const COMPATIBLE_AUDIO_DESCRIPTION = `${COMPATIBLE_AUDIO} (Copy)`;
const LEGACY_AUDIO = 'MP2/MP3 Audio'
const LEGACY_AUDIO_DESCRIPTION = `${LEGACY_AUDIO} (Copy)`;
const OTHER_AUDIO = 'Other Audio';
const OTHER_AUDIO_DESCRIPTION = `${OTHER_AUDIO} (Transcode)`;
const PCM_AUDIO = 'PCM or G.711 Audio';
const PCM_AUDIO_DESCRIPTION = `${PCM_AUDIO} (Copy, Unstable)`;
const compatibleAudio = ['aac', 'mp3', 'mp2', 'AAC', 'MP3', 'MP2', '', undefined, null];

interface PrebufferStreamChunk {
  chunk: StreamChunk;
  time: number;
}

interface Prebuffers {
  mp4: PrebufferStreamChunk[];
  mpegts: PrebufferStreamChunk[];
  s16le: PrebufferStreamChunk[];
}

class PrebufferSession {

  parserSessionPromise: Promise<FFMpegRebroadcastSession>;
  parserSession: FFMpegRebroadcastSession;
  prebuffers: Prebuffers = {
    mp4: [],
    mpegts: [],
    s16le: [],
  };
  parsers: { [container: string]: StreamParser };

  events = new EventEmitter();
  detectedIdrInterval = 0;
  prevIdr = 0;
  incompatibleDetected = false;
  legacyDetected = false;
  audioDisabled = false;

  mixinDevice: VideoCamera;
  console: Console;
  storage: Storage;

  AUDIO_CONFIGURATION = AUDIO_CONFIGURATION_TEMPLATE + '-' + this.streamId;

  constructor(public mixin: PrebufferMixin, public streamName: string, public streamId: string) {
    this.storage = mixin.storage;
    this.console = mixin.console;
    this.mixinDevice = mixin.mixinDevice;
  }

  ensurePrebufferSession() {
    if (this.parserSessionPromise || this.mixin.released)
      return;
    this.console.log('prebuffer session started', this.streamId);
    this.parserSessionPromise = this.startPrebufferSession();
    this.parserSessionPromise.catch(() => this.parserSessionPromise = undefined);
  }

  getAudioConfig(): {
    audioConfig: string,
    pcmAudio: boolean,
    legacyAudio: boolean,
    reencodeAudio: boolean,
  } {
    const audioConfig = this.storage.getItem(this.AUDIO_CONFIGURATION) || '';
    // pcm audio only used when explicitly set.
    const pcmAudio = audioConfig.indexOf(PCM_AUDIO) !== -1;
    const legacyAudio = audioConfig.indexOf(LEGACY_AUDIO) !== -1;
    // reencode audio will be used if explicitly set.
    const reencodeAudio = audioConfig.indexOf(OTHER_AUDIO) !== -1;
    return {
      audioConfig,
      pcmAudio,
      legacyAudio,
      reencodeAudio,
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    const session = this.parserSession;

    let total = 0;
    let start = 0;
    for (const prebuffer of this.prebuffers.mp4) {
      start = start || prebuffer.time;
      for (const chunk of prebuffer.chunk.chunks) {
        total += chunk.byteLength;
      }
    }
    const elapsed = Date.now() - start;
    const bitrate = Math.round(total / elapsed * 8);

    const group = this.streamName ? `Rebroadcast: ${this.streamName}` : 'Rebroadcast';

    settings.push(
      {
        title: 'Audio Codec Transcoding',
        group,
        description: 'Configuring your camera to output AAC, MP3, or MP2 is recommended. PCM/G711 cameras should set this to Reencode.',
        type: 'string',
        key: this.AUDIO_CONFIGURATION,
        value: this.storage.getItem(this.AUDIO_CONFIGURATION) || DEFAULT_AUDIO,
        choices: [
          DEFAULT_AUDIO,
          COMPATIBLE_AUDIO_DESCRIPTION,
          LEGACY_AUDIO_DESCRIPTION,
          OTHER_AUDIO_DESCRIPTION,
          PCM_AUDIO_DESCRIPTION,
        ],
      },
      {
        key: 'detectedResolution',
        group,
        title: 'Detected Resolution and Bitrate',
        readonly: true,
        value: `${session?.inputVideoResolution?.[0] || "unknown"} @ ${bitrate || "unknown"} Kb/s`,
        description: 'Configuring your camera to 1920x1080, 2000Kb/S, Variable Bit Rate, is recommended.',
      },
      {
        key: 'detectedCodec',
        group,
        title: 'Detected Video/Audio Codecs',
        readonly: true,
        value: (session?.inputVideoCodec?.toString() || 'unknown') + '/' + (session?.inputAudioCodec?.toString() || 'unknown'),
        description: 'Configuring your camera to H264 video and AAC/MP3/MP2 audio is recommended.'
      },
      {
        key: 'detectedKeyframe',
        group,
        title: 'Detected Keyframe Interval',
        description: "Configuring your camera to 4 seconds is recommended (IDR aka Frame Interval = FPS * 4 seconds).",
        readonly: true,
        value: ((this.detectedIdrInterval || 0) / 1000).toString() || 'none',
      },
      {
        group,
        key: 'rebroadcastUrl',
        title: 'Rebroadcast Url',
        readonly: true,
        value: this.parserSession?.ffmpegInputs?.mpegts.url,
      }
    );
    return settings;
  }

  async startPrebufferSession() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    this.prebuffers.s16le = [];
    const prebufferDurationMs = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;

    const probe = await probeVideoCamera(this.mixinDevice);
    let mso: MediaStreamOptions;
    if (probe.options) {
      mso = probe.options.find(mso => mso.id === this.streamId);
    }
    const probeAudioCodec = probe?.options?.[0]?.audio?.codec;
    this.incompatibleDetected = this.incompatibleDetected || (probeAudioCodec && !compatibleAudio.includes(probeAudioCodec));
    if (this.incompatibleDetected)
      this.console.warn('configure your camera to output aac, mp3, or mp2 audio. incompatible audio codec detected', probeAudioCodec);

    const mo = await this.mixinDevice.getVideoStream(mso);
    const moBuffer = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.FFmpegInput);
    const ffmpegInput = JSON.parse(moBuffer.toString()) as FFMpegInput;

    const { audioConfig, pcmAudio, reencodeAudio, legacyAudio } = this.getAudioConfig();
    const isUsingDefaultAudioConfig = !audioConfig || audioConfig === DEFAULT_AUDIO;
    const forceNoAudio = this.incompatibleDetected && isUsingDefaultAudioConfig;

    this.audioDisabled = false;
    let acodec: string[];
    if (probe.noAudio || forceNoAudio) {
      // no audio? explicitly disable it.
      acodec = ['-an'];
      this.audioDisabled = true;
    }
    else if (pcmAudio) {
      acodec = ['-an'];
    }
    else if (reencodeAudio) {
      // setting no audio codec will allow ffmpeg to do an implicit conversion.
      acodec = [
        '-bsf:a', 'aac_adtstoasc',
        '-acodec', 'libfdk_aac',
        '-profile:a', 'aac_low',
        '-flags', '+global_header',
        '-ar', `8k`,
        '-b:a', `100k`,
        '-ac', `1`,
      ];
    }
    else {
      // NOTE: if there is no audio track, this will still work fine.
      acodec = [
        '-acodec',
        'copy',
        ...(legacyAudio || this.legacyDetected ? [] : ['-bsf:a', 'aac_adtstoasc']),
      ];
    }

    const vcodec = [
      '-vcodec',
      'copy',
    ];

    const rbo: FFMpegRebroadcastOptions = {
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
      },
    };

    // if pcm prebuffer is requested, create the the parser. don't do it if
    // the camera wants to mute the audio though.
    if (!probe.noAudio && !forceNoAudio && pcmAudio) {
      rbo.parsers.s16le = createPCMParser();
    }

    this.parsers = rbo.parsers;

    // create missing pts from dts so mpegts and mp4 muxing does not fail
    ffmpegInput.inputArguments.unshift('-fflags', '+genpts');

    const session = await startRebroadcastSession(ffmpegInput, rbo);
    this.parserSession = session;

    let watchdog: NodeJS.Timeout;
    const restartWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        this.console.error('watchdog for mp4 parser timed out... killing ffmpeg session');
        session.kill();
      }, 60000);
    }
    session.events.on('mp4-data', restartWatchdog);

    session.events.once('killed', () => {
      this.parserSessionPromise = undefined;
      session.events.removeListener('mp4-data', restartWatchdog);
      clearTimeout(watchdog);
    });

    restartWatchdog();

    if (!session.inputAudioCodec) {
      this.console.warn('no audio detected.');
    }
    else if (!compatibleAudio.includes(session.inputAudioCodec)) {
      this.console.error('Detected audio codec is not mp4/mpegts compatible.', session.inputAudioCodec);
      // show an alert if no audio config was explicitly specified. Force the user to choose/experiment.
      if (isUsingDefaultAudioConfig && !probe.noAudio) {
        log.a(`${this.mixin.name} is using the ${session.inputAudioCodec} audio codec and has had its audio disabled. Select Disable Audio on your Camera or select Reencode Audio in Rebroadcast Settings Audio Configuration to suppress this alert.`);
        this.incompatibleDetected = true;
        // this will probably crash ffmpeg due to mp4/mpegts not being a valid container for pcm,
        // and then it will automatically restart with pcm handling.
      }
    }
    else if (session.inputAudioCodec?.toLowerCase() !== 'aac') {
      this.console.error('Detected audio codec was not AAC.', session.inputAudioCodec);
      if (!legacyAudio) {
        log.a(`${this.mixin.name} is using ${session.inputAudioCodec} audio. Enable MP2/MP3 Audio in Rebroadcast Settings Audio Configuration to suppress this alert.`);
        this.legacyDetected = true;
        // this will probably crash ffmpeg due to mp2/mp3 not supporting the aac bit stream filters,
        // and then it will automatically restart with legacy handling.
      }
    }

    if (session.inputVideoCodec !== 'h264') {
      this.console.error(`video codec is not h264. If there are errors, try changing your camera's encoder output.`);
    }

    // s16le will be a no-op if there's no pcm, no harm.
    for (const container of ['mpegts', 'mp4', 's16le']) {
      const eventName = container + '-data';
      let prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];
      let shifts = 0;

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
          shifts++;
        }

        if (shifts > 1000) {
          prebufferContainer = this.prebuffers[container] = prebufferContainer.slice();
          shifts = 0;
        }

        this.events.emit(eventName, chunk);
      });
    }

    return session;
  }

  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    this.ensurePrebufferSession();

    const session = await this.parserSessionPromise;

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) !== 'false';
    const requestedPrebuffer = options?.prebuffer || (sendKeyframe ? Math.max(4000, (this.detectedIdrInterval || 4000)) * 1.5 : 0);

    if (!options?.prebuffer && !sendKeyframe) {
      const mo = mediaManager.createFFmpegMediaObject(session.ffmpegInputs['mpegts']);
      return mo;
    }

    this.console.log('prebuffer request started', this.streamId);

    const createContainerServer = async (container: string) => {
      const eventName = container + '-data';
      const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];

      const { server, port } = await createRebroadcaster({
        connect: (writeData, destroy) => {
          server.close();
          const now = Date.now();


          const safeWriteData = (chunk: StreamChunk) => {
            const buffered = writeData(chunk);
            if (buffered > 100000000) {
              this.console.log('more than 100MB has been buffered, did downstream die? killing connection.');
              cleanup();
            }
          }

          const cleanup = () => {
            destroy();
            this.console.log('prebuffer request ended');
            this.events.removeListener(eventName, safeWriteData);
            session.events.removeListener('killed', cleanup);
          }

          this.events.on(eventName, safeWriteData);
          session.events.once('killed', cleanup);

          // for (const prebuffer of prebufferContainer) {
          //   if (prebuffer.time < now - requestedPrebuffer)
          //     continue;

          //   safeWriteData(prebuffer.chunk);
          // }

          // for some reason this doesn't work as well as simply guessing and dumping.
          const parser = this.parsers[container];
          const availablePrebuffers = parser.findSyncFrame(prebufferContainer.filter(pb => pb.time >= now - requestedPrebuffer).map(pb => pb.chunk));
          for (const prebuffer of availablePrebuffers) {
            safeWriteData(prebuffer);
          }
          return cleanup;
        }
      })

      setTimeout(() => server.close(), 30000);

      return port;
    }

    const container = options?.container || 'mpegts';

    const mediaStreamOptions = session.ffmpegInputs[container].mediaStreamOptions
      ? Object.assign({}, session.ffmpegInputs[container].mediaStreamOptions)
      : {};

    mediaStreamOptions.prebuffer = requestedPrebuffer;

    const { audioConfig, pcmAudio, reencodeAudio } = this.getAudioConfig();

    if (this.audioDisabled) {
      mediaStreamOptions.audio = null;
    }
    else if (reencodeAudio) {
      mediaStreamOptions.audio = {
        codec: 'aac',
      }
    }
    else {
      mediaStreamOptions.audio = {
        codec: session?.inputAudioCodec,
      }
    }

    if (mediaStreamOptions.video && session.inputVideoResolution?.[2] && session.inputVideoResolution?.[3]) {
      Object.assign(mediaStreamOptions.video, {
        width: parseInt(session.inputVideoResolution[2]),
        height: parseInt(session.inputVideoResolution[3]),
      })
    }

    const url = `tcp://127.0.0.1:${await createContainerServer(container)}`;
    const ffmpegInput: FFMpegInput = {
      url,
      container,
      inputArguments: [
        '-analyzeduration', '0', '-probesize', '500000',
        '-f', container,
        '-i', url,
      ],
      mediaStreamOptions,
    }

    if (pcmAudio) {
      ffmpegInput.inputArguments.push(
        '-analyzeduration', '0', '-probesize', '500000',
        '-f', 's16le',
        '-i', `tcp://127.0.0.1:${await createContainerServer('s16le')}`,
      )
    }

    // this.console.log('prebuffer ffmpeg input', ffmpegInput);
    const mo = mediaManager.createFFmpegMediaObject(ffmpegInput);
    return mo;
  }
}

class PrebufferMixin extends SettingsMixinDeviceBase<VideoCamera> implements VideoCamera, Settings {
  released = false;
  sessions = new Map<string, PrebufferSession>();

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, providerNativeId: string) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId,
      mixinDeviceInterfaces,
      group: "Prebuffer Settings",
      groupKey: "prebuffer",
    });

    this.delayStart();
  }

  delayStart() {
    this.console.log('prebuffer sessions starting in 5 seconds');
    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    setTimeout(() => this.ensurePrebufferSessions(), 5000);
  }

  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    await this.ensurePrebufferSessions();

    let id = options?.id;
    if (!id && !this.sessions.has(id)) {
      const stream = await this.mixinDevice.getVideoStream(options);
      const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(stream, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
      id = ffmpegInput?.mediaStreamOptions?.id;
      // this MAY be null.
      this.sessions.set(options?.id, this.sessions.get(id));
    }
    let session = this.sessions.get(id);
    if (!session)
      return this.mixinDevice.getVideoStream(options);
    session.ensurePrebufferSession();
    await session.parserSessionPromise;
    session = this.sessions.get(id);
    if (!session)
      return this.mixinDevice.getVideoStream(options);
    return session.getVideoStream(options);
  }

  async ensurePrebufferSessions() {
    const msos = await this.mixinDevice.getVideoStreamOptions();
    const enabled = this.getEnabledMediaStreamOptions(msos);
    const ids = enabled ? enabled.map(mso => mso.id) : [undefined];

    let active = 0;
    const total = ids.length;
    for (const id of ids) {
      let session = this.sessions.get(id);
      if (!session) {
        const mso = msos?.find(mso => mso.id === id);
        if (mso?.prebuffer) {
          log.a(`Prebuffer is already available on ${this.name}. If this is a grouped device, disable the Rebroadcast extension.`)
        }
        const name = mso?.name;
        session = new PrebufferSession(this, name, id);
        this.sessions.set(id, session);

        (async () => {
          while (this.sessions.get(id) === session && !this.released) {
            session.ensurePrebufferSession();
            try {
              const ps = await session.parserSessionPromise;
              active++;
              this.online = active == total;
              await once(ps.events, 'killed');
              this.console.error('prebuffer session ended');
            }
            catch (e) {
              this.console.error('prebuffer session ended with error', e);
            }
            finally {
              active--;
              this.online = active == total;
            }
            this.console.log('restarting prebuffer session in 5 seconds');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          this.console.log('exiting prebuffer session (released or restarted with new configuration)');
        })();
      }
    }
    deviceManager.onMixinEvent(this.id, this.mixinProviderNativeId, ScryptedInterface.Settings, undefined);
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    try {
      const msos = await this.mixinDevice.getVideoStreamOptions();
      const enabledStreams = this.getEnabledMediaStreamOptions(msos);
      if (enabledStreams && msos?.length > 1) {
        settings.push(
          {
            title: 'Prebuffered Streams',
            description: 'The streams to prebuffer. Enable only as necessary to reduce traffic.',
            key: 'enabledStreams',
            value: enabledStreams.map(mso => mso.name || ''),
            choices: msos.map(mso => mso.name),
            multiple: true,
          },
        )
      }
    }
    catch (e) {
      this.console.error('error in getVideoStreamOptions', e);
      throw e;
    }


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
    );


    for (const session of new Set([...this.sessions.values()])) {
      if (!session)
        continue;
      try {
        settings.push(...await session.getMixinSettings());
      }
      catch (e) {
        this.console.error('error in prebuffer session getMixinSettings', e);
        throw e;
      }
    }

    return settings;
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    const sessions = this.sessions;
    this.sessions = new Map();
    if (key === 'enabledStreams') {
      this.storage.setItem(key, JSON.stringify(value));
    }
    else {
      this.storage.setItem(key, value.toString());
    }
    for (const session of sessions.values()) {
      session?.parserSessionPromise?.then(session => session.kill());
    }
    this.ensurePrebufferSessions();
  }

  getEnabledMediaStreamOptions(msos?: MediaStreamOptions[]) {
    if (!msos || !msos.length)
      return;

    try {
      const parsed: any[] = JSON.parse(this.storage.getItem('enabledStreams'));
      const filtered = msos.filter(mso => parsed.includes(mso.name));
      return filtered;
    }
    catch (e) {
    }
    return [msos[0]];
  }

  async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
    const ret: MediaStreamOptions[] = await this.mixinDevice.getVideoStreamOptions() || [];
    let enabledStreams = this.getEnabledMediaStreamOptions(ret);

    const prebuffer = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;

    if (!enabledStreams) {
      ret.push({
        prebuffer,
      });
    }
    else {
      for (const enabledStream of enabledStreams) {
        enabledStream.prebuffer = prebuffer;
      }
    }
    return ret;
  }

  release() {
    this.console.log('prebuffer releasing if started');
    this.released = true;
    for (const session of this.sessions.values()) {
      session?.parserSessionPromise?.then(session => {
        this.console.log('prebuffer released');
        session.kill();
      });
    }
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
    return [ScryptedInterface.VideoCamera, ScryptedInterface.Settings, ScryptedInterface.Online];
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    this.setHasEnabledMixin(mixinDeviceState.id);
    return new PrebufferMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.online = true;
    mixinDevice.release();
  }
}

export default new PrebufferProvider();
