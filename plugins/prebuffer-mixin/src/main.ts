
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput, RequestMediaStreamOptions } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { once } from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { createRebroadcaster, ParserOptions, ParserSession, startParserSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { probeVideoCamera } from '@scrypted/common/src/media-helpers';
import { createMpegTsParser, createFragmentedMp4Parser, StreamChunk, createPCMParser, StreamParser } from '@scrypted/common/src/stream-parser';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';

const { mediaManager, log, systemManager, deviceManager } = sdk;

const defaultPrebufferDuration = 10000;
const PREBUFFER_DURATION_MS = 'prebufferDuration';
const SEND_KEYFRAME = 'sendKeyframe';
const AUDIO_CONFIGURATION_KEY_PREFIX = 'audioConfiguration-';
const DEFAULT_AUDIO = 'Default';
const COMPATIBLE_AUDIO = 'AAC or No Audio';
const COMPATIBLE_AUDIO_DESCRIPTION = `${COMPATIBLE_AUDIO} (Copy)`;
const LEGACY_AUDIO = 'MP2/MP3 Audio'
const LEGACY_AUDIO_DESCRIPTION = `${LEGACY_AUDIO} (Copy)`;
const OTHER_AUDIO = 'Other Audio';
const OTHER_AUDIO_DESCRIPTION = `${OTHER_AUDIO} (Transcode)`;
const PCM_AUDIO = 'PCM or G.711 Audio';
const PCM_AUDIO_DESCRIPTION = `${PCM_AUDIO} (Copy, Unstable)`;
const compatibleAudio = ['aac', 'mp3', 'mp2', 'AAC', 'MP3', 'MP2', 'opus', 'OPUS', '', undefined, null];

interface PrebufferStreamChunk {
  chunk: StreamChunk;
  time: number;
}

interface Prebuffers {
  mp4: PrebufferStreamChunk[];
  mpegts: PrebufferStreamChunk[];
  s16le: PrebufferStreamChunk[];
}

type PrebufferParsers = "mpegts" | "mp4" | "s16le";
const PrebufferParserValues: PrebufferParsers[] = ['mpegts', 'mp4', 's16le'];

class PrebufferSession {

  parserSessionPromise: Promise<ParserSession<PrebufferParsers>>;
  parserSession: ParserSession<PrebufferParsers>;
  prebuffers: Prebuffers = {
    mp4: [],
    mpegts: [],
    s16le: [],
  };
  parsers: { [container: string]: StreamParser };

  detectedIdrInterval = 0;
  prevIdr = 0;
  incompatibleDetected = false;
  legacyDetected = false;
  audioDisabled = false;

  mixinDevice: VideoCamera;
  console: Console;
  storage: Storage;

  activeClients = 0;
  inactivityTimeout: NodeJS.Timeout;
  audioConfigurationKey: string;

  constructor(public mixin: PrebufferMixin, public streamName: string, public streamId: string, public stopInactive: boolean) {
    this.storage = mixin.storage;
    this.console = mixin.console;
    this.mixinDevice = mixin.mixinDevice;
    this.audioConfigurationKey = AUDIO_CONFIGURATION_KEY_PREFIX + this.streamId;
  }

  clearPrebuffers() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    this.prebuffers.s16le = [];
  }

  ensurePrebufferSession() {
    if (this.parserSessionPromise || this.mixin.released)
      return;
    this.console.log(this.streamName, 'prebuffer session started');
    this.parserSessionPromise = this.startPrebufferSession();
    this.parserSessionPromise.catch(() => this.parserSessionPromise = undefined);
  }

  getAudioConfig(): {
    audioConfig: string,
    pcmAudio: boolean,
    legacyAudio: boolean,
    reencodeAudio: boolean,
  } {
    const audioConfig = this.storage.getItem(this.audioConfigurationKey) || '';
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
        description: 'Configuring your camera to output AAC, MP3, MP2, or Opus is recommended. PCM/G711 cameras should set this to Transcode.',
        type: 'string',
        key: this.audioConfigurationKey,
        value: this.storage.getItem(this.audioConfigurationKey) || DEFAULT_AUDIO,
        choices: [
          DEFAULT_AUDIO,
          COMPATIBLE_AUDIO_DESCRIPTION,
          LEGACY_AUDIO_DESCRIPTION,
          OTHER_AUDIO_DESCRIPTION,
          PCM_AUDIO_DESCRIPTION,
        ],
      },
    );

    if (session) {
      settings.push(
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
          description: 'Configuring your camera to H264 video and AAC/MP3/MP2/Opus audio is recommended.'
        },
        {
          key: 'detectedKeyframe',
          group,
          title: 'Detected Keyframe Interval',
          description: "Configuring your camera to 4 seconds is recommended (IDR aka Frame Interval = FPS * 4 seconds).",
          readonly: true,
          value: ((this.detectedIdrInterval || 0) / 1000).toString() || 'none',
        },
      );
    }
    else {
      settings.push(
        {
          title: 'Status',
          group,
          key: 'status',
          description: 'Rebroadcast is currently idle and will be started automatically on demand.',
          value: 'Idle',
          readonly: true,
        },
      )
    }

    return settings;
  }

  async startPrebufferSession() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    this.prebuffers.s16le = [];
    const prebufferDurationMs = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;

    // todo: there's a bug here where probe's noAudio check looks at the first media stream option entry
    const probe = await probeVideoCamera(this.mixinDevice);
    let mso: MediaStreamOptions;
    if (probe.options) {
      mso = probe.options.find(mso => mso.id === this.streamId);
    }
    const probeAudioCodec = mso?.audio?.codec;
    this.incompatibleDetected = this.incompatibleDetected || (probeAudioCodec && !compatibleAudio.includes(probeAudioCodec));
    if (this.incompatibleDetected)
      this.console.warn('configure your camera to output aac, mp3, mp2, or opus audio. incompatible audio codec detected', probeAudioCodec);

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

    const rbo: ParserOptions<PrebufferParsers> = {
      console: this.console,
      timeout: 60000,
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

    const session = await startParserSession(ffmpegInput, rbo);
    this.parserSession = session;

    // cloud streams need a periodic token refresh.
    if (ffmpegInput.mediaStreamOptions?.refreshAt) {
      let mso = ffmpegInput.mediaStreamOptions;
      let refreshTimeout: NodeJS.Timeout;

      const refreshStream = async () => {
        if (!session.isActive)
          return;
        const mo = await this.mixinDevice.getVideoStream(mso);
        const moBuffer = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(moBuffer.toString()) as FFMpegInput;
        mso = ffmpegInput.mediaStreamOptions

        scheduleRefresh(ffmpegInput);
      };

      const scheduleRefresh = (ffmpegInput: FFMpegInput) => {
        const when = ffmpegInput.mediaStreamOptions.refreshAt - Date.now() - 30000;
        this.console.log('refreshing media stream in', when);
        refreshTimeout = setTimeout(refreshStream, when);
      }

      scheduleRefresh(ffmpegInput);
      session.once('killed', () => clearTimeout(refreshTimeout));
    }

    session.once('killed', () => {
      this.parserSessionPromise = undefined;
      if (this.parserSession === session)
        this.parserSession = undefined;
    });

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
        // this will probably crash ffmpeg due to mp2/mp3/opus not supporting the aac bit stream filters,
        // and then it will automatically restart with legacy handling.
      }
    }

    if (session.inputVideoCodec !== 'h264') {
      this.console.error(`video codec is not h264. If there are errors, try changing your camera's encoder output.`);
    }

    // s16le will be a no-op if there's no pcm, no harm.
    for (const container of PrebufferParserValues) {
      let shifts = 0;

      session.on(container, (chunk: StreamChunk) => {
        const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];
        const now = Date.now();

        // this is only valid for mp4, so its no op for everything else
        // used to detect idr interval.
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
          this.prebuffers[container] = prebufferContainer.slice();
          shifts = 0;
        }
      });
    }

    return session;
  }

  printActiveClients() {
    this.console.log(this.streamName, 'active rebroadcast clients:', this.activeClients);
  }

  inactivityCheck(session: ParserSession<PrebufferParsers>) {
    this.printActiveClients();
    if (!this.stopInactive)
      return;
    if (this.activeClients)
      return;
    
    clearTimeout(this.inactivityTimeout)
    this.inactivityTimeout = setTimeout(() => {
      if (this.activeClients)
        return;
      this.console.log(this.streamName, 'terminating rebroadcast due to inactivity');
      session.kill();
    }, 30000);
  }

  async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
    this.ensurePrebufferSession();

    const session = await this.parserSessionPromise;

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) !== 'false';
    const requestedPrebuffer = options?.prebuffer || (sendKeyframe ? Math.max(4000, (this.detectedIdrInterval || 4000)) * 1.5 : 0);

    this.console.log(this.streamName, 'prebuffer request started');

    const createContainerServer = async (container: PrebufferParsers) => {
      const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];

      const { server, port } = await createRebroadcaster({
        connect: (writeData, destroy) => {
          this.activeClients++;
          this.printActiveClients();

          server.close();
          const now = Date.now();

          const safeWriteData = (chunk: StreamChunk) => {
            const buffered = writeData(chunk);
            if (buffered > 100000000) {
              this.console.log('more than 100MB has been buffered, did downstream die? killing connection.', this.streamName);
              cleanup();
            }
          }

          const cleanup = () => {
            destroy();
            this.console.log(this.streamName, 'prebuffer request ended');
            session.removeListener(container, safeWriteData);
            session.removeListener('killed', cleanup);
          }

          session.on(container, safeWriteData);
          session.once('killed', cleanup);

          if (true) {
            for (const prebuffer of prebufferContainer) {
              if (prebuffer.time < now - requestedPrebuffer)
                continue;

              safeWriteData(prebuffer.chunk);
            }
          }
          else {
            // for some reason this doesn't work as well as simply guessing and dumping.
            const parser = this.parsers[container];
            const availablePrebuffers = parser.findSyncFrame(prebufferContainer.filter(pb => pb.time >= now - requestedPrebuffer).map(pb => pb.chunk));
            for (const prebuffer of availablePrebuffers) {
              safeWriteData(prebuffer);
            }
          }

          return () => {
            this.activeClients--;
            this.inactivityCheck(session);
            cleanup();
          };
        }
      })

      setTimeout(() => server.close(), 30000);

      return port;
    }

    const container: PrebufferParsers = PrebufferParserValues.find(parser => parser === options?.container) || 'mpegts';

    const mediaStreamOptions: MediaStreamOptions = Object.assign({}, session.mediaStreamOptions);

    mediaStreamOptions.prebuffer = requestedPrebuffer;

    const { audioConfig, pcmAudio, reencodeAudio } = this.getAudioConfig();

    if (this.audioDisabled) {
      mediaStreamOptions.audio = null;
    }
    else if (reencodeAudio) {
      mediaStreamOptions.audio = {
        codec: 'aac',
        encoder: 'libfdk_aac',
        profile: 'aac_eld',
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

    const now = Date.now();
    let available = 0;
    const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];
    for (const prebuffer of prebufferContainer) {
      if (prebuffer.time < now - requestedPrebuffer)
        continue;
      for (const chunk of prebuffer.chunk.chunks) {
        available += chunk.length;
      }
    }

    const length = Math.max(500000, available).toString();

    const url = `tcp://127.0.0.1:${await createContainerServer(container)}`;
    const ffmpegInput: FFMpegInput = {
      url,
      container,
      inputArguments: [
        '-analyzeduration', '0', '-probesize', length,
        '-f', container,
        '-i', url,
      ],
      mediaStreamOptions,
    }

    if (pcmAudio) {
      ffmpegInput.inputArguments.push(
        '-analyzeduration', '0', '-probesize', length,
        '-f', 's16le',
        '-i', `tcp://127.0.0.1:${await createContainerServer('s16le')}`,
      )
    }

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

  async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
    await this.ensurePrebufferSessions();

    const id = options?.id;
    let session = this.sessions.get(id);
    if (!session || options?.directMediaStream)
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
    const enabledIds = enabled ? enabled.map(mso => mso.id) : [undefined];
    const ids = msos?.map(mso => mso.id) || [undefined];

    const isBatteryPowered = this.mixinDeviceInterfaces.includes(ScryptedInterface.Battery);

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
        const notEnabled = !enabledIds.includes(id)
        const stopInactive = isBatteryPowered || notEnabled;
        session = new PrebufferSession(this, name, id, stopInactive);
        this.sessions.set(id, session);
        if (id === msos?.[0]?.id)
          this.sessions.set(undefined, session);

        if (isBatteryPowered) {
          this.console.log('camera is battery powered, prebuffering and rebroadcasting will only work on demand.');
          continue;
        }

        if (notEnabled) {
          this.console.log('stream', name, 'will be rebroadcast on demand.');
          continue;
        }

        (async () => {
          while (this.sessions.get(id) === session && !this.released) {
            session.ensurePrebufferSession();
            try {
              const ps = await session.parserSessionPromise;
              active++;
              this.online = active == total;
              await once(ps, 'killed');
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
      if (msos?.length > 0) {
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
    if (!msos)
      return;

    try {
      const parsed: any[] = JSON.parse(this.storage.getItem('enabledStreams'));
      const filtered = msos.filter(mso => parsed.includes(mso.name));
      return filtered;
    }
    catch (e) {
    }
    // do not enable rebroadcast on cloud streams by default.
    const firstNonCloudStream = msos.find(mso => mso.source !== 'cloud');
    return firstNonCloudStream ? [firstNonCloudStream] : [];
  }

  async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
    const ret: MediaStreamOptions[] = await this.mixinDevice.getVideoStreamOptions() || [];
    let enabledStreams = this.getEnabledMediaStreamOptions(ret);

    const prebuffer = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;

    if (!enabledStreams) {
      ret.push({
        id: 'default',
        name: 'Default',
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
      if (!session)
        continue;
      session.clearPrebuffers();
      session.parserSessionPromise?.then(parserSession => {
        this.console.log('prebuffer released');
        parserSession.kill();
        session.clearPrebuffers();
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
