
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import EventEmitter from 'events';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { createRebroadcaster, FFMpegRebroadcastOptions, FFMpegRebroadcastSession, startRebroadcastSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { probeVideoCamera } from '@scrypted/common/src/media-helpers';
import { createMpegTsParser, createFragmentedMp4Parser, MP4Atom, StreamChunk, createPCMParser, StreamParser } from '@scrypted/common/src/stream-parser';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';

const { mediaManager, log, systemManager, deviceManager } = sdk;

const defaultPrebufferDuration = 15000;
const PREBUFFER_DURATION_MS = 'prebufferDuration';
const SEND_KEYFRAME = 'sendKeyframe';
const AUDIO_CONFIGURATION = 'audioConfiguration';
const COMPATIBLE_AUDIO = 'MPEG-TS/MP4 Compatible or No Audio (Copy)';
const OTHER_AUDIO = 'Other Audio';
const OTHER_AUDIO_DESCRIPTION = `${OTHER_AUDIO} (Transcode)`;
const PCM_AUDIO = 'PCM Audio';
const PCM_AUDIO_DESCRIPTION = `${PCM_AUDIO} (Copy, !Experimental!)`;
const compatibleAudio = ['aac', 'mp3', 'mp2', '', undefined, null];

interface PrebufferStreamChunk {
  chunk: StreamChunk;
  time: number;
}

class PrebufferMixin extends SettingsMixinDeviceBase<VideoCamera> implements VideoCamera, Settings {
  prebufferSession: Promise<FFMpegRebroadcastSession>;
  session: FFMpegRebroadcastSession;
  prebuffers = {
    mp4: [],
    mpegts: [],
    s16le: [],
  };
  parsers: { [container: string]: StreamParser };

  events = new EventEmitter();
  released = false;
  detectedIdrInterval = 0;
  prevIdr = 0;
  incompatibleDetected = false;
  allowImmediateRestart = false;

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

    const msos = await this.mixinDevice.getVideoStreamOptions();
    const enabledStream = this.getEnabledMediaStreamOption(msos);
    if (enabledStream) {
      settings.push(
        {
          title: 'Enabled Stream',
          description: 'The stream to prebuffer.',
          key: 'enabledStream',
          value: enabledStream.name,
          choices: msos.map(mso => mso.name),
        },
      )
    }

    const session = this.session;

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
        title: 'Audio Codec Transcoding',
        description: 'Configuring your camera to output AAC, MP3, or MP2 is recommended. PCM/G711 cameras should set this to Reencode.',
        type: 'string',
        key: AUDIO_CONFIGURATION,
        value: this.storage.getItem(AUDIO_CONFIGURATION) || COMPATIBLE_AUDIO,
        choices: [
          COMPATIBLE_AUDIO,
          OTHER_AUDIO_DESCRIPTION,
          PCM_AUDIO_DESCRIPTION,
        ],
      },
      {
        group: 'Media Information',
        title: 'Detected Resolution',
        readonly: true,
        key: 'detectedAcodec',
        value: `${session?.inputVideoResolution?.[0] || "unknown"}`,
        description: 'Configuring your camera to 1920x1080 is recommended.',
      },
      {
        group: 'Media Information',
        title: 'Detected Video/Audio Codecs',
        readonly: true,
        key: 'detectedVcodec',
        value: (session?.inputVideoCodec?.toString() || 'unknown') + '/' + (session?.inputAudioCodec?.toString() || 'unknown'),
        description: 'Configuring your camera to H264 video (2000Kb/s) and AAC/MP3/MP2 audio is recommended.'
      },
      {
        group: 'Media Information',
        title: 'Detected Keyframe Interval',
        description: "Configuring your camera to 4 seconds is recommended (IDR = FPS * 4 seconds).",
        readonly: true,
        key: 'detectedIdr',
        value: ((this.detectedIdrInterval || 0) / 1000).toString() || 'none',
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

  getAudioConfig(): {
    audioConfig: string,
    pcmAudio: boolean,
    reencodeAudio: boolean,
  } {
    const audioConfig = this.storage.getItem(AUDIO_CONFIGURATION) || '';
    // pcm audio only used when explicitly set.
    const pcmAudio = audioConfig.indexOf(PCM_AUDIO) !== -1;
    // reencode audio will be used if explicitly set, OR an incompatible codec was detected, PCM audio was not explicitly set
    const reencodeAudio = audioConfig.indexOf(OTHER_AUDIO) !== -1 || (!pcmAudio && this.incompatibleDetected);
    return {
      audioConfig,
      pcmAudio,
      reencodeAudio,
    }
  }

  async startPrebufferSession() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    this.prebuffers.s16le = [];
    const prebufferDurationMs = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;

    const enabledStream = this.storage.getItem('enabledStream');
    const probe = await probeVideoCamera(this.mixinDevice);
    let mso: MediaStreamOptions;
    if (probe.options) {
      mso = probe.options.find(mso => mso.name === enabledStream);
    }
    const probeAudioCodec = probe?.options?.[0].audio?.codec;
    this.incompatibleDetected = this.incompatibleDetected || (probeAudioCodec && !compatibleAudio.includes(probeAudioCodec));
    if (this.incompatibleDetected)
      this.console.warn('configure your camera to output aac, mp3, or mp2 audio. incompatibl audio codec detected', probeAudioCodec);

    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await this.mixinDevice.getVideoStream(mso), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

    const { audioConfig, pcmAudio, reencodeAudio } = this.getAudioConfig();

    let acodec: string[];
    if (probe.noAudio || pcmAudio) {
      // no audio? explicitly disable it.
      acodec = ['-an'];
    }
    else if (reencodeAudio) {
      // setting no audio codec will allow ffmpeg to do an implicit conversion.
      acodec = [];
    }
    else {
      // NOTE: if there is no audio track, this will still work fine.
      acodec = [
        '-acodec',
        'copy',
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
      parseOnly: true,
    };

    if (pcmAudio) {
      rbo.parsers.s16le = createPCMParser();
    }

    this.parsers = rbo.parsers;

    const session = await startRebroadcastSession(ffmpegInput, rbo);
    this.session = session;

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
      this.prebufferSession = undefined;
      session.events.removeListener('mp4-data', restartWatchdog);
      clearTimeout(watchdog);
    });

    restartWatchdog();

    if (!session.inputAudioCodec) {
      this.console.warn('no audio detected.');
    }
    else if (!compatibleAudio.includes(session.inputAudioCodec)) {
      this.console.error('Detected audio codec was not AAC.', session.inputAudioCodec);
      // show an alert if no audio config was explicitly specified. Force the user to choose/experiment.
      if (!audioConfig) {
        log.a(`${this.name} is using ${session.inputAudioCodec} audio. Enable Reencode Audio in Rebroadcast Settings Audio Configuration to disable this alert.`);
        this.incompatibleDetected = true;
        this.allowImmediateRestart = true;
        // this will probably crash ffmpeg due to mp4/mpegts not being a valid container for pcm,
        // and then it will automatically restart with pcm handling.
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

    const session = await this.prebufferSession;

    // if a specific stream is requested, and it's not what we're streaming, just fall through to source.
    if (options?.id !== undefined && options.id !== session.ffmpegInputs['mpegts'].mediaStreamOptions?.id) {
      this.console.log('rebroadcast session cant be used here', options);
      return this.mixinDevice.getVideoStream(options);
    }

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) !== 'false';
    const requestedPrebuffer = options?.prebuffer || (sendKeyframe ? Math.max(4000, (this.detectedIdrInterval || 4000)) * 1.5 : 0);

    if (!options?.prebuffer && !sendKeyframe) {
      const mo = mediaManager.createFFmpegMediaObject(session.ffmpegInputs['mpegts']);
      return mo;
    }

    this.console.log('prebuffer request started');

    const createContainerServer = async (container: string) => {
      const eventName = container + '-data';
      const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];

      const { server, port } = await createRebroadcaster({
        connect: (writeData, destroy) => {
          server.close();
          const now = Date.now();

          const cleanup = () => {
            destroy();
            this.console.log('prebuffer request ended');
            this.events.removeListener(eventName, writeData);
            session.events.removeListener('killed', cleanup);
          }

          this.events.on(eventName, writeData);
          session.events.once('killed', cleanup);

          for (const prebuffer of prebufferContainer) {
            if (prebuffer.time < now - requestedPrebuffer)
              continue;

            writeData(prebuffer.chunk);
          }

          // for some reason this doesn't work as well as simply guessing and dumping.
          // const parser = this.parsers[container];
          // const availablePrebuffers = parser.findSyncFrame(prebufferContainer.filter(pb => pb.time >= now - requestedPrebuffer).map(pb => pb.chunk));
          // for (const prebuffer of availablePrebuffers) {
          //   writeData(prebuffer);
          // }
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

    if (mediaStreamOptions && mediaStreamOptions.audio) {
      if (reencodeAudio)
        mediaStreamOptions.audio = {
          codec: 'aac',
        }
    }

    if (mediaStreamOptions.video) {
      Object.assign(mediaStreamOptions.video, {
        width: parseInt(session.inputVideoResolution[2]),
        height: parseInt(session.inputVideoResolution[3]),
      })
    }

    const ffmpegInput: FFMpegInput = {
      inputArguments: [
        '-f', container,
        '-i', `tcp://127.0.0.1:${await createContainerServer(container)}`,
      ],
      mediaStreamOptions,
    }

    if (pcmAudio) {
      ffmpegInput.inputArguments.push(
        '-f', 's16le',
        '-i', `tcp://127.0.0.1:${await createContainerServer('s16le')}`,
      )
    }

    this.console.log('prebuffer ffmpeg input', ffmpegInput.inputArguments);
    const mo = mediaManager.createFFmpegMediaObject(ffmpegInput);
    return mo;
  }

  getEnabledMediaStreamOption(msos?: MediaStreamOptions[]) {
    if (msos?.length) {
      const enabledStream = this.storage.getItem('enabledStream');
      return msos.find(mso => mso.name === enabledStream) || msos[0];
    }
  }

  async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
    const ret: MediaStreamOptions[] = await this.mixinDevice.getVideoStreamOptions() || [];
    let enabledStream = this.getEnabledMediaStreamOption(ret);

    if (!enabledStream) {
      enabledStream = {};
      ret.push(enabledStream);
    }
    enabledStream.prebuffer = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;
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
