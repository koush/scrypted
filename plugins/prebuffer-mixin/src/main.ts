
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { getH264EncoderArgs, LIBX264_ENCODER_TITLE } from '@scrypted/common/src/ffmpeg-hardware-acceleration';
import { handleRebroadcasterClient, ParserOptions, ParserSession, startParserSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { closeQuiet, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { readLength } from '@scrypted/common/src/read-stream';
import { createRtspParser, findH264NaluType, H264_NAL_TYPE_IDR, H264_NAL_TYPE_SEI, RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import { StorageSettings } from '@scrypted/common/src/settings';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import { createFragmentedMp4Parser, createMpegTsParser, StreamChunk, StreamParser } from '@scrypted/common/src/stream-parser';
import sdk, { BufferConverter, DeviceProvider, FFmpegInput, MediaObject, MediaStreamOptions, MixinProvider, RequestMediaStreamOptions, ResponseMediaStreamOptions, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import crypto from 'crypto';
import net from 'net';
import { Duplex } from 'stream';
import { connectRFC4571Parser, startRFC4571Parser } from './rfc4571';
import { startRtspSession } from './rtsp-session';
import { createStreamSettings, getPrebufferedStreams } from './stream-settings';
import { getTranscodeMixinProviderId, REBROADCAST_MIXIN_INTERFACE_TOKEN, TranscodeMixinProvider, TRANSCODE_MIXIN_PROVIDER_NATIVE_ID } from './transcode-settings';

const { mediaManager, log, systemManager, deviceManager } = sdk;

const prebufferDurationMs = 10000;
const DEFAULT_AUDIO = 'Default';
const AAC_AUDIO = 'AAC or No Audio';
const AAC_AUDIO_DESCRIPTION = `${AAC_AUDIO} (Copy)`;
const COMPATIBLE_AUDIO = 'Compatible Audio'
const COMPATIBLE_AUDIO_DESCRIPTION = `${COMPATIBLE_AUDIO} (Copy)`;
const TRANSCODE_AUDIO = 'Other Audio';
const TRANSCODE_AUDIO_DESCRIPTION = `${TRANSCODE_AUDIO} (Transcode)`;
const COMPATIBLE_AUDIO_CODECS = ['aac', 'mp3', 'mp2', 'opus'];
const DEFAULT_FFMPEG_INPUT_ARGUMENTS = '-fflags +genpts';

const SCRYPTED_PARSER_TCP = 'Scrypted (TCP)';
const SCRYPTED_PARSER_UDP = 'Scrypted (UDP)';
const FFMPEG_PARSER_TCP = 'FFmpeg (TCP)';
const FFMPEG_PARSER_UDP = 'FFmpeg (UDP)';
const STRING_DEFAULT = 'Default';

const VALID_AUDIO_CONFIGS = [
  AAC_AUDIO,
  COMPATIBLE_AUDIO,
  TRANSCODE_AUDIO,
];

interface PrebufferStreamChunk extends StreamChunk {
  time?: number;
}

interface Prebuffers {
  mp4: PrebufferStreamChunk[];
  mpegts: PrebufferStreamChunk[];
  rtsp: PrebufferStreamChunk[];
}

type PrebufferParsers = 'mpegts' | 'mp4' | 'rtsp';
const PrebufferParserValues: PrebufferParsers[] = ['mpegts', 'mp4', 'rtsp'];

interface H264Probe {
  seiDetected?: boolean;
}

class PrebufferSession {

  parserSessionPromise: Promise<ParserSession<PrebufferParsers>>;
  parserSession: ParserSession<PrebufferParsers>;
  prebuffers: Prebuffers = {
    mp4: [],
    mpegts: [],
    rtsp: [],
  };
  parsers: { [container: string]: StreamParser };
  sdp: Promise<string>;

  audioDisabled = false;

  mixinDevice: VideoCamera & VideoCameraConfiguration;
  console: Console;
  storage: Storage;

  activeClients = 0;
  inactivityTimeout: NodeJS.Timeout;
  audioConfigurationKey: string;
  ffmpegInputArgumentsKey: string;
  lastDetectedAudioCodecKey: string;
  lastH264ProbeKey: string;
  rebroadcastModeKey: string;
  rtspParserKey: string;
  maxBitrateKey: string;
  rtspServerPath: string;
  needBitrateReset = false;

  constructor(public mixin: PrebufferMixin, public advertisedMediaStreamOptions: ResponseMediaStreamOptions, public stopInactive: boolean) {
    this.storage = mixin.storage;
    this.console = mixin.console;
    this.mixinDevice = mixin.mixinDevice;
    this.audioConfigurationKey = 'audioConfiguration-' + this.streamId;
    this.ffmpegInputArgumentsKey = 'ffmpegInputArguments-' + this.streamId;
    this.rebroadcastModeKey = 'rebroadcastMode-' + this.streamId;
    this.lastDetectedAudioCodecKey = 'lastDetectedAudioCodec-' + this.streamId;
    this.lastH264ProbeKey = 'lastH264Probe-' + this.streamId;
    this.rtspParserKey = 'rtspParser-' + this.streamId;
    const rtspServerPathKey = 'rtspServerPathKey-' + this.streamId;
    this.maxBitrateKey = 'maxBitrate-' + this.streamId;

    this.rtspServerPath = this.storage.getItem(rtspServerPathKey);
    if (!this.rtspServerPath) {
      this.rtspServerPath = crypto.randomBytes(8).toString('hex');
      this.storage.setItem(rtspServerPathKey, this.rtspServerPath);
    }
  }

  getLastH264Probe(): H264Probe {
    const str = this.storage.getItem(this.lastH264ProbeKey);
    if (!str) {
      return {};
    }

    try {
      return JSON.parse(str);
    }
    catch (e) {
      return {};
    }
  }

  getDetectedIdrInterval() {
    const durations: number[] = [];
    if (this.prebuffers.mp4.length) {
      let last: number;

      for (const chunk of this.prebuffers.mp4) {
        if (chunk.type === 'mdat') {
          if (last)
            durations.push(chunk.time - last);
          last = chunk.time;
        }
      }
    }
    else if (this.prebuffers.rtsp.length) {
      let last: number;

      for (const chunk of this.prebuffers.rtsp) {
        if (findH264NaluType(chunk, H264_NAL_TYPE_IDR)) {
          if (last)
            durations.push(chunk.time - last);
          last = chunk.time;
        }
      }
    }

    if (!durations.length)
      return;

    const total = durations.reduce((prev, current) => prev + current, 0);
    return total / durations.length;
  }

  get maxBitrate() {
    let ret = parseInt(this.storage.getItem(this.maxBitrateKey));
    if (!ret) {
      ret = this.advertisedMediaStreamOptions?.video?.maxBitrate;
      this.storage.setItem(this.maxBitrateKey, ret?.toString());
    }
    return ret || undefined;
  }

  async resetBitrate() {
    this.console.log('Resetting bitrate after adaptive streaming session', this.maxBitrate);
    this.needBitrateReset = false;
    this.mixinDevice.setVideoStreamOptions({
      id: this.streamId,
      video: {
        bitrate: this.maxBitrate,
      }
    });
  }

  get streamId() {
    return this.advertisedMediaStreamOptions.id;
  }

  get streamName() {
    return this.advertisedMediaStreamOptions.name;
  }

  clearPrebuffers() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    this.prebuffers.rtsp = [];
  }

  ensurePrebufferSession() {
    if (this.parserSessionPromise || this.mixin.released)
      return;
    this.console.log(this.streamName, 'prebuffer session started');
    this.parserSessionPromise = this.startPrebufferSession();
    this.parserSessionPromise.catch(() => this.parserSessionPromise = undefined);
  }

  getAudioConfig(): {
    isUsingDefaultAudioConfig: boolean,
    aacAudio: boolean,
    compatibleAudio: boolean,
    reencodeAudio: boolean,
  } {
    let audioConfig = this.storage.getItem(this.audioConfigurationKey) || '';
    if (!VALID_AUDIO_CONFIGS.find(config => audioConfig.startsWith(config)))
      audioConfig = '';
    const aacAudio = audioConfig.indexOf(AAC_AUDIO) !== -1;
    const compatibleAudio = audioConfig.indexOf(COMPATIBLE_AUDIO) !== -1;
    // reencode audio will be used if explicitly set.
    const reencodeAudio = audioConfig.indexOf(TRANSCODE_AUDIO) !== -1;
    return {
      isUsingDefaultAudioConfig: !(aacAudio || compatibleAudio || reencodeAudio),
      aacAudio,
      compatibleAudio,
      reencodeAudio,
    }
  }

  canUseRtspParser(mediaStreamOptions: MediaStreamOptions) {
    return mediaStreamOptions?.container?.startsWith('rtsp');
  }

  getParser(rtspMode: boolean, mediaStreamOptions: MediaStreamOptions) {
    let parser: string;
    const rtspParser = this.storage.getItem(this.rtspParserKey);

    if (!this.canUseRtspParser(mediaStreamOptions)) {
      parser = STRING_DEFAULT;
    }
    else {

      if (rtspParser === FFMPEG_PARSER_TCP)
        parser = FFMPEG_PARSER_TCP;
      if (rtspParser === FFMPEG_PARSER_UDP)
        parser = FFMPEG_PARSER_UDP;

      // scrypted parser can only be used in rtsp mode.
      if (rtspMode && !parser) {
        if (!rtspParser || rtspParser === STRING_DEFAULT)
          parser = SCRYPTED_PARSER_TCP;
        if (rtspParser === SCRYPTED_PARSER_TCP)
          parser = SCRYPTED_PARSER_TCP;
        if (rtspParser === SCRYPTED_PARSER_UDP)
          parser = SCRYPTED_PARSER_UDP;
      }

      // bad config, fall back to ffmpeg tcp parsing.
      if (!parser)
        parser = FFMPEG_PARSER_TCP;
    }

    return {
      parser,
      isDefault: !rtspParser || rtspParser === 'Default',
    }
  }

  getRebroadcastContainer() {
    let mode = this.storage.getItem(this.rebroadcastModeKey) || 'Default';
    if (mode === 'Default')
      mode = 'RTSP';
    const rtspMode = mode?.startsWith('RTSP');

    return {
      rtspMode: mode?.startsWith('RTSP'),
      muxingMp4: !rtspMode,
    };
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    const session = this.parserSession;

    let total = 0;
    let start = 0;
    const { muxingMp4, rtspMode } = this.getRebroadcastContainer();
    for (const prebuffer of (muxingMp4 ? this.prebuffers.mp4 : this.prebuffers.rtsp)) {
      start = start || prebuffer.time;
      for (const chunk of prebuffer.chunks) {
        total += chunk.byteLength;
      }
    }
    const elapsed = Date.now() - start;
    const bitrate = Math.round(total / elapsed * 8);

    const group = this.streamName ? `Stream: ${this.streamName}` : 'Stream';

    settings.push(
      {
        title: 'Rebroadcast Container',
        group,
        description: `The container format to use when rebroadcasting. The default mode for this camera is RTSP.`,
        placeholder: 'RTSP',
        choices: [
          STRING_DEFAULT,
          'MPEG-TS',
          'RTSP',
        ],
        key: this.rebroadcastModeKey,
        value: this.storage.getItem(this.rebroadcastModeKey) || STRING_DEFAULT,
      }
    );

    const addFFmpegAudioSettings = () => {
      settings.push(
        {
          title: 'Audio Codec Transcoding',
          group,
          description: 'Configuring your camera to output Opus, PCM, or AAC is recommended.',
          type: 'string',
          key: this.audioConfigurationKey,
          value: this.storage.getItem(this.audioConfigurationKey) || DEFAULT_AUDIO,
          choices: [
            DEFAULT_AUDIO,
            AAC_AUDIO_DESCRIPTION,
            COMPATIBLE_AUDIO_DESCRIPTION,
            TRANSCODE_AUDIO_DESCRIPTION,
          ],
        },
      );
    };

    const addFFmpegInputSettings = () => {
      settings.push(
        {
          title: 'FFmpeg Input Arguments Prefix',
          group,
          description: 'Optional/Advanced: Additional input arguments to pass to the ffmpeg command. These will be placed before the input arguments.',
          key: this.ffmpegInputArgumentsKey,
          value: this.storage.getItem(this.ffmpegInputArgumentsKey),
          placeholder: DEFAULT_FFMPEG_INPUT_ARGUMENTS,
          choices: [
            DEFAULT_FFMPEG_INPUT_ARGUMENTS,
            '-use_wallclock_as_timestamps 1',
            '-v verbose',
          ],
          combobox: true,
        },
      )
    }

    let usingFFmpeg = muxingMp4;

    if (this.canUseRtspParser(this.advertisedMediaStreamOptions)) {
      const canUseScryptedParser = rtspMode;
      const defaultValue = canUseScryptedParser && !this.getLastH264Probe()?.seiDetected ?
        SCRYPTED_PARSER_TCP : FFMPEG_PARSER_TCP;

      const scryptedOptions = canUseScryptedParser ? [
        SCRYPTED_PARSER_TCP,
        SCRYPTED_PARSER_UDP,
      ] : [];

      const currentParser = this.storage.getItem(this.rtspParserKey) || STRING_DEFAULT;

      settings.push(
        {
          key: this.rtspParserKey,
          group,
          title: 'RTSP Parser',
          description: `The RTSP Parser used to read the stream. The default is "${defaultValue}" for this container.`,
          value: currentParser,
          choices: [
            STRING_DEFAULT,
            ...scryptedOptions,
            FFMPEG_PARSER_TCP,
            FFMPEG_PARSER_UDP,
          ],
        }
      );

      if (!(currentParser === STRING_DEFAULT ? defaultValue : currentParser).includes('Scrypted')) {
        usingFFmpeg = true;
      }
    }

    if (muxingMp4) {
      addFFmpegAudioSettings();
    }
    if (usingFFmpeg) {
      addFFmpegInputSettings();
    }

    if (session) {
      const resolution = session.inputVideoResolution?.width && session.inputVideoResolution?.height
        ? `${session.inputVideoResolution?.width}x${session.inputVideoResolution?.height}`
        : 'unknown';

      const idrInterval = this.getDetectedIdrInterval();
      settings.push(
        {
          key: 'detectedResolution',
          group,
          title: 'Detected Resolution and Bitrate',
          readonly: true,
          value: `${resolution} @ ${bitrate || "unknown"} Kb/s`,
          description: 'Configuring your camera to 1920x1080, 2000Kb/S, Variable Bit Rate, is recommended.',
        },
        {
          key: 'detectedCodec',
          group,
          title: 'Detected Video/Audio Codecs',
          readonly: true,
          value: (session?.inputVideoCodec?.toString() || 'unknown') + '/' + (session?.inputAudioCodec?.toString() || 'unknown'),
          description: 'Configuring your camera to H264 video and Opus, PCM, or AAC audio is recommended.'
        },
        {
          key: 'detectedKeyframe',
          group,
          title: 'Detected Keyframe Interval',
          description: "Configuring your camera to 4 seconds is recommended (IDR aka Frame Interval = FPS * 4 seconds).",
          readonly: true,
          value: (idrInterval || 0) / 1000 || 'unknown',
        },
        {
          key: 'detectedSEI',
          group,
          title: 'Detected H264 SEI',
          readonly: true,
          value: `${!!this.getLastH264Probe().seiDetected}`,
          description: 'Cameras with SEI in the H264 video stream may not function correctly with Scrypted RTSP Parsers.',
        }
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

    if (rtspMode) {
      settings.push({
        group,
        key: 'rtspRebroadcastUrl',
        title: 'RTSP Rebroadcast Url',
        description: 'The RTSP URL of the rebroadcast stream. Substitute localhost as appropriate.',
        readonly: true,
        value: `rtsp://localhost:${this.mixin.plugin.storageSettings.values.rebroadcastPort}/${this.rtspServerPath}`,
      });
    }

    if (this.mixin.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCameraConfiguration)) {
      settings.push({
        group,
        key: this.maxBitrateKey,
        title: 'Max Bitrate',
        description: 'This camera supports Adaptive Bitrate. Set the maximum bitrate to be allowed while using adaptive bitrate streaming. This will also serve as the default bitrate.',
        type: 'number',
        value: this.maxBitrate?.toString(),
      });
    }

    return settings;
  }

  async startPrebufferSession() {
    this.prebuffers.mp4 = [];
    this.prebuffers.mpegts = [];
    this.prebuffers.rtsp = [];

    let mso: ResponseMediaStreamOptions;
    try {
      mso = (await this.mixinDevice.getVideoStreamOptions()).find(o => o.id === this.streamId);
    }
    catch (e) {
    }

    // audio codecs are determined by probing the camera to see what it reports.
    // if the camera does not specify a codec, rebroadcast will force audio off
    // to determine the codec without causing a parse failure.
    // camera may explicity request that its audio stream be muted via a null.
    // respect that setting.
    const audioSoftMuted = mso?.audio === null;
    const advertisedAudioCodec = mso?.audio?.codec;

    const { isUsingDefaultAudioConfig, aacAudio, compatibleAudio, reencodeAudio } = this.getAudioConfig();

    const { rtspMode, muxingMp4 } = this.getRebroadcastContainer();

    let detectedAudioCodec = this.storage.getItem(this.lastDetectedAudioCodecKey) || undefined;
    if (detectedAudioCodec === 'null')
      detectedAudioCodec = null;

    // only need to probe the audio under specific circumstances.
    // rtsp only mode (ie, no mp4 mux) does not need probing.
    let probingAudioCodec = false;
    if (muxingMp4
      && !audioSoftMuted
      && !advertisedAudioCodec
      && isUsingDefaultAudioConfig
      && detectedAudioCodec === undefined) {
      this.console.warn('Camera did not report an audio codec, muting the audio stream and probing the codec.');
      probingAudioCodec = true;
    }

    // the assumed audio codec is the detected codec first and the reported codec otherwise.
    const assumedAudioCodec = detectedAudioCodec === undefined
      ? advertisedAudioCodec?.toLowerCase()
      : detectedAudioCodec?.toLowerCase();


    // after probing the audio codec is complete, alert the user with appropriate instructions.
    // assume the codec is user configurable unless the camera explictly reports otherwise.
    const audioIncompatible = !COMPATIBLE_AUDIO_CODECS.includes(assumedAudioCodec);
    if (muxingMp4 && !probingAudioCodec && mso?.userConfigurable !== false && !audioSoftMuted) {
      if (audioIncompatible) {
        // show an alert that rebroadcast needs an explicit setting by the user.
        if (isUsingDefaultAudioConfig) {
          log.a(`${this.mixin.name} is using the ${assumedAudioCodec} audio codec. Configuring your Camera to use Opus, PCM, or AAC audio is recommended. If this is not possible, Select 'Transcode Audio' in the camera stream's Rebroadcast settings to suppress this alert.`);
        }
        this.console.warn('Configure your camera to output Opus, PCM, or AAC audio. Suboptimal audio codec in use:', assumedAudioCodec);
      }
      else if (!audioSoftMuted && isUsingDefaultAudioConfig && advertisedAudioCodec === undefined && detectedAudioCodec !== undefined) {
        // handling compatible codecs that were unspecified...
        // if (detectedAudioCodec === 'aac') {
        //   log.a(`${this.mixin.name} did not report a codec and ${detectedAudioCodec} was found during probe. Select '${AAC_AUDIO}' in the camera stream's Rebroadcast settings to suppress this alert and improve startup time.`);
        // }
        // else {
        //   log.a(`${this.mixin.name} did not report a codec and ${detectedAudioCodec} was found during probe. Select '${COMPATIBLE_AUDIO}' in the camera stream's Rebroadcast settings to suppress this alert and improve startup time.`);
        // }
      }
    }

    // aac needs to have the adts header stripped for mpegts and mp4.
    // use this filter sparingly as it prevents ffmpeg from starting on a mismatch.
    // however, not using it on an aac stream also prevents ffmpeg from parsing.
    // so only use it when the detected or probe codec reports aac.
    const aacFilters = ['-bsf:a', 'aac_adtstoasc'];
    // compatible audio like mp3, mp2, opus can be muxed without issue.
    const compatibleFilters = [];

    this.audioDisabled = false;
    let acodec: string[];

    const detectedNoAudio = detectedAudioCodec === null;

    // if the camera reports audio is incompatible and the user can't do anything about it
    // enable transcoding by default. however, still allow the user to change the settings
    // in case something changed.
    let mustTranscode = false;
    if (muxingMp4 && !probingAudioCodec && isUsingDefaultAudioConfig && audioIncompatible) {
      if (mso?.userConfigurable === false)
        this.console.log('camera reports it is not user configurable. transcoding due to incompatible codec', assumedAudioCodec);
      else
        this.console.log('camera audio transcoding due to incompatible codec. configure the camera to use a compatible codec if possible.');
      mustTranscode = true;
    }

    if (audioSoftMuted || probingAudioCodec) {
      // no audio? explicitly disable it.
      acodec = ['-an'];
      this.audioDisabled = true;
    }
    else if (reencodeAudio || mustTranscode) {
      acodec = [
        '-bsf:a', 'aac_adtstoasc',
        '-acodec', 'aac',
        '-ar', `32k`,
        '-b:a', `32k`,
        '-ac', `1`,
        '-profile:a', 'aac_low',
        '-flags', '+global_header',
      ];
    }
    else if (aacAudio || detectedNoAudio) {
      // NOTE: If there is no audio track, the aac filters will still work fine without complaints
      // from ffmpeg. This is why AAC and No Audio can be grouped into a single setting.
      // This is preferred, because failure and recovery is preferable to
      // permanently muting camera audio due to erroneous detection.
      acodec = [
        '-acodec',
        'copy',
      ];
      acodec.push(...aacFilters);
    }
    else if (compatibleAudio) {
      acodec = [
        '-acodec',
        'copy',
      ];
      acodec.push(...compatibleFilters);
    }
    else {
      acodec = [
        '-acodec',
        'copy',
      ];

      const filters = assumedAudioCodec === 'aac' ? aacFilters : compatibleFilters;

      acodec.push(...filters);
    }

    const vcodec = [
      '-vcodec', 'copy',
      // 3/6/2022
      // Add SPS/PPS to all keyframes. Not all cameras do this!
      // This isn't really necessary for a few reasons:
      // MPEG-TS and MP4 will automatically do this, since there's no out of band
      // way to get the SPS/PPS.
      // RTSP mode may send the SPS/PPS out of band via the sdp, and then may not have
      // SPS/PPS in the bit stream.
      // Adding this argument isn't strictly necessary, but it normalizes the bitstream
      // so consumers that expect the SPS/PPS will have it. Ran into an issue where
      // the HomeKit plugin was blasting RTP packets out from RTSP mode,
      // but the bitstream had no SPS/PPS information, resulting in the video never loading
      // in the Home app.
      // 3/7/2022
      // I believe this is causing errors in recordings and possibly streaming as well
      // for some users. This may need to be a homekit specific transcoding argument.
      // '-bsf:v', 'dump_extra',
    ];

    const rbo: ParserOptions<PrebufferParsers> = {
      console: this.console,
      timeout: 60000,
      parsers: {
      },
    };
    this.parsers = rbo.parsers;

    this.console.log('rebroadcast mode:', rtspMode ? 'rtsp' : 'mpegts');
    if (!rtspMode) {
      rbo.parsers.mpegts = createMpegTsParser({
        vcodec,
        acodec,
      });
    }
    else {
      const parser = createRtspParser({
        vcodec,
        // the rtsp parser should always stream copy unless audio is soft muted.
        acodec: ['-acodec', 'copy'],
      });
      this.sdp = parser.sdp;
      rbo.parsers.rtsp = parser;
    }

    if (muxingMp4) {
      rbo.parsers.mp4 = createFragmentedMp4Parser({
        vcodec,
        acodec,
      });
    }

    const mo = await this.mixinDevice.getVideoStream(mso);
    const isRfc4571 = mo.mimeType === 'x-scrypted/x-rfc4571';

    let session: ParserSession<PrebufferParsers>;
    let sessionMso: ResponseMediaStreamOptions;

    // before launching the parser session, clear out the last detected codec.
    // an erroneous cached codec could cause ffmpeg to fail to start.
    this.storage.removeItem(this.lastDetectedAudioCodecKey);
    let usingScryptedParser = false;
    let restartOnSei = false;

    if (rtspMode && isRfc4571) {
      usingScryptedParser = true;
      this.console.log('bypassing ffmpeg: using scrypted rfc4571 parser')
      const json = await mediaManager.convertMediaObjectToJSON<any>(mo, 'x-scrypted/x-rfc4571');
      const { url, sdp, mediaStreamOptions } = json;

      session = startRFC4571Parser(this.console, connectRFC4571Parser(url), sdp, mediaStreamOptions, rbo);
      this.sdp = session.sdp.then(buffers => Buffer.concat(buffers).toString());
    }
    else {
      const moBuffer = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.FFmpegInput);
      const ffmpegInput = JSON.parse(moBuffer.toString()) as FFmpegInput;
      sessionMso = ffmpegInput.mediaStreamOptions || this.advertisedMediaStreamOptions;

      let { parser, isDefault } = this.getParser(rtspMode, sessionMso);
      usingScryptedParser = parser === SCRYPTED_PARSER_TCP || parser === SCRYPTED_PARSER_UDP;

      // if the stream is not marked as scrypted parser compatible by the plugin,
      // play it safe and restart the stream when an sei packet is detected.
      restartOnSei = usingScryptedParser && isDefault && sessionMso.tool !== 'scrypted';

      if (isDefault && usingScryptedParser && this.getLastH264Probe().seiDetected) {
        if (sessionMso.tool === 'scrypted') {
          this.console.warn('SEI packet detected was in video stream, but stream is marked safe by Scrypted. The Default Scrypted RTSP Parser will  be used. This can be overriden by setting the RTSP Parser to Scrypted.');
        }
        else {
          this.console.warn('SEI packet detected was in video stream, the Default Scrypted RTSP Parser will not be used. Falling back to FFmpeg. This can be overriden by setting the RTSP Parser to Scrypted.');
          usingScryptedParser = false;
          parser = FFMPEG_PARSER_TCP;
        }
      }

      if (usingScryptedParser) {
        session = await startRtspSession(this.console, ffmpegInput.url, ffmpegInput.mediaStreamOptions, {
          useUdp: parser === SCRYPTED_PARSER_UDP,
          audioSoftMuted,
          rtspRequestTimeout: 10000,
        });
        this.sdp = session.sdp.then(buffers => Buffer.concat(buffers).toString());
      }
      else {
        if (parser === FFMPEG_PARSER_UDP)
          ffmpegInput.inputArguments = ['-rtsp_transport', 'udp', '-i', ffmpegInput.url];
        else if (parser === FFMPEG_PARSER_TCP)
          ffmpegInput.inputArguments = ['-rtsp_transport', 'tcp', '-i', ffmpegInput.url];
        // create missing pts from dts so mpegts and mp4 muxing does not fail
        const extraInputArguments = this.storage.getItem(this.ffmpegInputArgumentsKey) || DEFAULT_FFMPEG_INPUT_ARGUMENTS;
        ffmpegInput.inputArguments.unshift(...extraInputArguments.split(' '));
        session = await startParserSession(ffmpegInput, rbo);
      }
    }

    // watch the stream for 10 seconds to see if an sei packet is encountered.
    // if one is found and using scrypted parser as default, will need to restart rebroadcast to prevent
    // downstream issues.
    const seiProbe = (chunk: StreamChunk) => {
      if (chunk.type !== 'h264')
        return;
      const seiDetected = !!findH264NaluType(chunk, H264_NAL_TYPE_SEI);
      if (seiDetected) {
        removeSeiProbe();
        clearTimeout(seiTimeout);
        const h264Probe: H264Probe = {
          seiDetected,
        }
        this.storage.setItem(this.lastH264ProbeKey, JSON.stringify(h264Probe));
        if (!usingScryptedParser)
          return;

        let { isDefault } = this.getParser(rtspMode, sessionMso);
        if (!isDefault || sessionMso.tool === 'scrypted') {
          this.console.warn('SEI packet detected while operating with Scrypted Parser. If there are issues streaming, consider using the Default parser.');
          return;
        }
        this.console.warn('SEI packet detected while operating with Scrypted Parser as default. Restarting rebroadcast.');
        session.kill();
        this.startPrebufferSession();
      }
    }
    const removeSeiProbe = () => session.removeListener('rtsp', seiProbe);
    session.on('rtsp', seiProbe);
    const seiTimeout = setTimeout(() => {
      removeSeiProbe();
      const h264Probe: H264Probe = {
        seiDetected: false,
      }
      this.storage.setItem(this.lastH264ProbeKey, JSON.stringify(h264Probe));
    }, 10000);

    // complain to the user about the codec if necessary. upstream may send a audio
    // stream but report none exists (to request muting).
    if (!audioSoftMuted && advertisedAudioCodec && session.inputAudioCodec !== undefined
      && session.inputAudioCodec !== advertisedAudioCodec) {
      this.console.warn('Audio codec plugin reported vs detected mismatch', advertisedAudioCodec, detectedAudioCodec);
    }

    const advertisedVideoCodec = mso?.video?.codec;
    if (advertisedVideoCodec && session.inputVideoCodec !== undefined
      && session.inputVideoCodec !== advertisedVideoCodec) {
      this.console.warn('Video codec plugin reported vs detected mismatch', advertisedVideoCodec, session.inputVideoCodec);
    }

    if (!session.inputAudioCodec) {
      this.console.log('No audio stream detected.');
    }
    else if (!COMPATIBLE_AUDIO_CODECS.includes(session.inputAudioCodec?.toLowerCase())) {
      this.console.log('Detected audio codec is not mp4/mpegts compatible.', session.inputAudioCodec);
    }
    else {
      this.console.log('Detected audio codec is mp4/mpegts compatible.', session.inputAudioCodec);
    }

    // set/update the detected codec, set it to null if no audio was found.
    this.storage.setItem(this.lastDetectedAudioCodecKey, session.inputAudioCodec || 'null');

    if (session.inputVideoCodec !== 'h264') {
      this.console.error(`Video codec is not h264. If there are errors, try changing your camera's encoder output.`);
    }

    if (probingAudioCodec) {
      this.console.warn('Audio probe complete, ending rebroadcast session and restarting with detected codecs.');
      session.kill();
      return this.startPrebufferSession();
    }

    this.parserSession = session;

    // settings ui refresh
    deviceManager.onMixinEvent(this.mixin.id, this.mixin.mixinProviderNativeId, ScryptedInterface.Settings, undefined);

    // cloud streams need a periodic token refresh.
    if (sessionMso?.refreshAt) {
      let mso = sessionMso;
      let refreshTimeout: NodeJS.Timeout;

      const refreshStream = async () => {
        if (!session.isActive)
          return;
        const mo = await this.mixinDevice.getVideoStream(mso);
        const moBuffer = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(moBuffer.toString()) as FFmpegInput;
        mso = ffmpegInput.mediaStreamOptions;

        scheduleRefresh(mso);
      };

      const scheduleRefresh = (refreshMso: ResponseMediaStreamOptions) => {
        const when = refreshMso.refreshAt - Date.now() - 30000;
        this.console.log('refreshing media stream in', when);
        refreshTimeout = setTimeout(refreshStream, when);
      }

      scheduleRefresh(mso);
      session.killed.finally(() => clearTimeout(refreshTimeout));
    }

    session.killed.finally(() => {
      clearTimeout(this.inactivityTimeout)
      this.parserSessionPromise = undefined;
      if (this.parserSession === session)
        this.parserSession = undefined;
    });

    for (const container of PrebufferParserValues) {
      let shifts = 0;
      let prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];

      session.on(container, (chunk: PrebufferStreamChunk) => {
        const now = Date.now();

        chunk.time = now;
        prebufferContainer.push(chunk);

        while (prebufferContainer.length && prebufferContainer[0].time < now - prebufferDurationMs) {
          prebufferContainer.shift();
          shifts++;
        }

        if (shifts > 100000) {
          prebufferContainer = prebufferContainer.slice();
          this.prebuffers[container] = prebufferContainer;
          shifts = 0;
        }
      });
    }

    return session;
  }

  printActiveClients() {
    this.console.log(this.streamName, 'active rebroadcast clients:', this.activeClients);
  }

  inactivityCheck(session: ParserSession<PrebufferParsers>, resetTimeout: boolean) {
    if (this.activeClients)
      return;

    // should bitrate be reset immediately once the stream goes inactive?
    if (this.needBitrateReset && this.mixin.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCameraConfiguration)) {
      this.resetBitrate();
    }

    if (!this.stopInactive) {
      return;
    }

    // passive clients should not reset timeouts.
    if (this.inactivityTimeout && !resetTimeout)
      return;

    clearTimeout(this.inactivityTimeout)
    this.inactivityTimeout = setTimeout(() => {
      this.inactivityTimeout = undefined;
      if (this.activeClients) {
        this.console.log('inactivity timeout found active clients.');
        return;
      }
      this.console.log(this.streamName, 'terminating rebroadcast due to inactivity');
      session.kill();
    }, 30000);
  }

  async handleRebroadcasterClient(options: {
    requestedContainer: string,
    isActiveClient: boolean,
    container: PrebufferParsers,
    session: ParserSession<PrebufferParsers>,
    socketPromise: Promise<Duplex>,
    requestedPrebuffer: number,
    filter?: (chunk: StreamChunk, prebuffer: boolean) => StreamChunk,
  }) {
    const { isActiveClient, container, session, socketPromise, requestedPrebuffer } = options;
    if (requestedPrebuffer)
      this.console.log('sending prebuffer', requestedPrebuffer);

    handleRebroadcasterClient(socketPromise, {
      // console: this.console,
      connect: (writeData, destroy) => {
        if (isActiveClient) {
          this.activeClients++;
          this.printActiveClients();
        }
        else {
          // this.console.log('passive client request started');
        }

        const now = Date.now();

        const safeWriteData = (chunk: StreamChunk, prebuffer?: boolean) => {
          if (options.filter) {
            chunk = options.filter(chunk, prebuffer);
            if (!chunk)
              return;
          }
          const buffered = writeData(chunk);
          if (buffered > 100000000) {
            this.console.log('more than 100MB has been buffered, did downstream die? killing connection.', this.streamName);
            cleanup();
          }
        }

        const cleanup = () => {
          session.removeListener(container, safeWriteData);
          session.removeListener('killed', cleanup);
          destroy();
        }

        session.on(container, safeWriteData);
        session.once('killed', cleanup);

        const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];
        // if the requested container or the source container is not rtsp, use an exact seek.
        // this works better when the requested container is mp4, and rtsp is the source.
        // if starting on a sync frame, ffmpeg will skip the first segment while initializing
        // on live sources like rtsp. the buffer before the sync frame stream will be enough
        // for ffmpeg to analyze and start up in time for the sync frame.
        // may be worth considering playing with a few other things to avoid this:
        // mpeg-ts as a container (would need to write a muxer)
        // specifying the buffer before the sync frame with probesize.
        if (container !== 'rtsp'
          || (options?.requestedContainer && options?.requestedContainer !== 'rtsp')) {
          for (const chunk of prebufferContainer) {
            if (chunk.time < now - requestedPrebuffer)
              continue;

            safeWriteData(chunk, true);
          }
        }
        else {
          const parser = this.parsers[container];
          const filtered = prebufferContainer.filter(pb => pb.time >= now - requestedPrebuffer);
          let availablePrebuffers = parser.findSyncFrame(filtered);
          if (!availablePrebuffers) {
            this.console.warn('Unable to find sync frame in rtsp prebuffer.');
            availablePrebuffers = filtered;
          }
          for (const prebuffer of availablePrebuffers) {
            safeWriteData(prebuffer, true);
          }
        }

        return () => {
          if (isActiveClient) {
            this.activeClients--;
            this.printActiveClients();
          }
          this.inactivityCheck(session, isActiveClient);
          cleanup();
        };
      }
    })
  }

  async getVideoStream(options?: RequestMediaStreamOptions) {
    if (options?.refresh === false && !this.parserSessionPromise)
      throw new Error('Stream is currently unavailable and will not be started for this request. RequestMediaStreamOptions.refresh === false');

    this.ensurePrebufferSession();

    const session = await this.parserSessionPromise;

    const idrInterval = Math.max(4000, this.getDetectedIdrInterval() || 4000);
    let requestedPrebuffer = options?.prebuffer;
    if (requestedPrebuffer == null) {
      // get into the general area of finding a sync frame.
      requestedPrebuffer = idrInterval * 1.5;
    }

    const { rtspMode, muxingMp4 } = this.getRebroadcastContainer();
    const defaultContainer = rtspMode ? 'rtsp' : 'mpegts';

    let container: PrebufferParsers = this.parsers[options?.container] ? options?.container as PrebufferParsers : defaultContainer;

    const mediaStreamOptions: ResponseMediaStreamOptions = session.negotiateMediaStream(options);
    let sdp = await this.sdp;

    let socketPromise: Promise<Duplex>;
    let url: string;
    let filter: (chunk: StreamChunk, prebuffer: boolean) => StreamChunk;
    const codecMap = new Map<string, number>();

    if (container === 'rtsp') {
      const parsedSdp = parseSdp(sdp);
      const videoSection = parsedSdp.msections.find(msection => msection.codec && msection.codec === mediaStreamOptions.video?.codec) || parsedSdp.msections.find(msection => msection.type === 'video');
      let audioSection = parsedSdp.msections.find(msection => msection.codec && msection.codec === mediaStreamOptions.audio?.codec) || parsedSdp.msections.find(msection => msection.type === 'audio');
      if (mediaStreamOptions.audio === null)
        audioSection = undefined;
      parsedSdp.msections = parsedSdp.msections.filter(msection => msection === videoSection || msection === audioSection);
      const filterPrebufferAudio = options?.prebuffer === undefined;
      const videoCodec = parsedSdp.msections.find(msection => msection.type === 'video')?.codec;
      sdp = parsedSdp.toSdp();
      filter = (chunk, prebuffer) => {
        const channel = codecMap.get(chunk.type);
        if (channel == undefined)
          return;
        // if no prebuffer is explicitly requested, don't send prebuffer audio
        if (prebuffer && filterPrebufferAudio && chunk.type !== videoCodec)
          return;
        const chunks = chunk.chunks.slice();
        const header = Buffer.from(chunks[0]);
        header.writeUInt8(channel, 1);
        chunks[0] = header;
        return {
          startStream: chunk.startStream,
          chunks,
        }
      }

      const client = await listenZeroSingleClient();
      socketPromise = client.clientPromise.then(async (socket) => {
        sdp = addTrackControls(sdp);
        const server = new RtspServer(socket, sdp);
        // server.console = this.console;
        await server.handlePlayback();
        for (const track of Object.values(server.setupTracks)) {
          codecMap.set(track.codec, track.destination);
          codecMap.set(`rtcp-${track.codec}`, track.destination + 1);
        }
        return socket;
      })
      url = client.url.replace('tcp://', 'rtsp://');
    }
    else {
      const client = await listenZeroSingleClient();
      socketPromise = client.clientPromise;
      url = `tcp://127.0.0.1:${client.port}`
    }

    mediaStreamOptions.sdp = sdp;

    const isActiveClient = options?.refresh !== false;

    this.handleRebroadcasterClient({
      requestedContainer: options?.container,
      isActiveClient,
      container,
      requestedPrebuffer,
      socketPromise,
      session,
      filter,
    });

    mediaStreamOptions.prebuffer = requestedPrebuffer;

    const { reencodeAudio } = this.getAudioConfig();

    if (this.audioDisabled) {
      mediaStreamOptions.audio = null;
    }
    else if (reencodeAudio && muxingMp4) {
      mediaStreamOptions.audio = {
        codec: 'aac',
        encoder: 'aac',
        profile: 'aac_low',
      }
    }

    if (session.inputVideoResolution?.width && session.inputVideoResolution?.height) {
      // this may be an audio only request.
      if (mediaStreamOptions.video)
        Object.assign(mediaStreamOptions.video, session.inputVideoResolution);
    }

    const now = Date.now();
    let available = 0;
    const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];
    for (const prebuffer of prebufferContainer) {
      if (prebuffer.time < now - requestedPrebuffer)
        continue;
      for (const chunk of prebuffer.chunks) {
        available += chunk.length;
      }
    }

    const length = Math.max(500000, available).toString();

    const ffmpegInput: FFmpegInput = {
      url,
      container,
      inputArguments: [
        '-analyzeduration', '0', '-probesize', length,
        ...(this.parsers[container].inputArguments || []),
        '-f', this.parsers[container].container,
        '-i', url,
      ],
      mediaStreamOptions,
    }

    return ffmpegInput;
  }
}

class PrebufferMixin extends SettingsMixinDeviceBase<VideoCamera & VideoCameraConfiguration> implements VideoCamera, Settings, VideoCameraConfiguration {
  released = false;
  sessions = new Map<string, PrebufferSession>();

  streamSettings = createStreamSettings(this);

  constructor(public plugin: RebroadcastPlugin, options: SettingsMixinDeviceOptions<VideoCamera & VideoCameraConfiguration>) {
    super(options);

    this.delayStart();
  }

  delayStart() {
    this.console.log('prebuffer sessions starting in 5 seconds');
    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    setTimeout(() => this.ensurePrebufferSessions(), 5000);
  }

  async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
    if (options?.directMediaStream)
      return this.mixinDevice.getVideoStream(options);

    await this.ensurePrebufferSessions();

    let id = options?.id;
    let h264EncoderArguments: string[];
    let destinationVideoBitrate: number;

    const transcodingEnabled = this.mixins?.includes(getTranscodeMixinProviderId());

    const msos = await this.mixinDevice.getVideoStreamOptions();
    let result: {
      stream: ResponseMediaStreamOptions,
      isDefault: boolean,
      title: string;
    };

    const defaultLocalBitrate = 2000000;
    const defaultLowResolutionBitrate = 512000;
    if (!id) {
      switch (options?.destination) {
        case 'medium-resolution':
        case 'remote':
          result = this.streamSettings.getRemoteStream(msos);
          destinationVideoBitrate = this.plugin.transcodeStorageSettings.values.remoteStreamingBitrate;
          break;
        case 'low-resolution':
          result = this.streamSettings.getLowResolutionStream(msos);
          destinationVideoBitrate = defaultLowResolutionBitrate;
          break;
        case 'local-recorder':
          result = this.streamSettings.getRecordingStream(msos);
          destinationVideoBitrate = defaultLocalBitrate;
          break;
        case 'remote-recorder':
          result = this.streamSettings.getRemoteRecordingStream(msos);
          destinationVideoBitrate = defaultLocalBitrate;
          break;
        default:
          result = this.streamSettings.getDefaultStream(msos);
          destinationVideoBitrate = defaultLocalBitrate;
          break;
      }

      id = result.stream.id;
      this.console.log('Selected stream', result.stream.name);
      // transcoding video should never happen transparently since it is CPU intensive.
      // encourage users at every step to configure proper codecs.
      // for this reason, do not automatically supply h264 encoder arguments
      // even if h264 is requested, to force a visible failure.
      if (transcodingEnabled && this.streamSettings.storageSettings.values.transcodeStreams?.includes(result.title)) {
        h264EncoderArguments = this.plugin.transcodeStorageSettings.values.h264EncoderArguments?.split(' ');
      }
    }

    const session = this.sessions.get(id);
    if (!session)
      return this.mixinDevice.getVideoStream(options);

    const ffmpegInput = await session.getVideoStream(options);
    ffmpegInput.h264EncoderArguments = h264EncoderArguments;
    ffmpegInput.destinationVideoBitrate = destinationVideoBitrate;

    if (transcodingEnabled && this.streamSettings.storageSettings.values.missingCodecParameters) {
      ffmpegInput.h264FilterArguments = ffmpegInput.h264FilterArguments || [];
      ffmpegInput.h264FilterArguments.push("-bsf:v", "dump_extra");
    }

    if (transcodingEnabled)
      ffmpegInput.videoDecoderArguments = this.streamSettings.storageSettings.values.videoDecoderArguments?.split(' ');
    return mediaManager.createFFmpegMediaObject(ffmpegInput, {
      sourceId: this.id,
    });
  }

  async ensurePrebufferSessions() {
    const msos = await this.mixinDevice.getVideoStreamOptions();
    const enabled = this.getPrebufferedStreams(msos);
    const enabledIds = enabled ? enabled.map(mso => mso.id) : [undefined];
    const ids = msos?.map(mso => mso.id) || [undefined];

    if (this.storage.getItem('warnedCloud') !== 'true') {
      const cloud = msos?.find(mso => mso.source === 'cloud');
      if (cloud) {
        this.storage.setItem('warnedCloud', 'true');
        log.a(`${this.name} is a cloud camera. Prebuffering maintains a persistent stream and will not enabled by default. You must enable the Prebuffer stream manually.`)
      }
    }

    const isBatteryPowered = this.mixinDeviceInterfaces.includes(ScryptedInterface.Battery);

    let active = 0;
    for (const id of ids) {
      let session = this.sessions.get(id);
      if (!session) {
        const mso = msos?.find(mso => mso.id === id);
        if (mso?.prebuffer) {
          log.a(`Prebuffer is already available on ${this.name}. If this is a grouped device, disable the Rebroadcast extension.`)
        }
        const name = mso?.name;
        const enabled = enabledIds.includes(id);
        const stopInactive = isBatteryPowered || !enabled;
        session = new PrebufferSession(this, mso, stopInactive);
        this.sessions.set(id, session);

        if (isBatteryPowered) {
          this.console.log('camera is battery powered, prebuffering and rebroadcasting will only work on demand.');
          continue;
        }

        if (!enabled) {
          this.console.log('stream', name, 'will be rebroadcast on demand.');
          continue;
        }

        (async () => {
          while (this.sessions.get(id) === session && !this.released) {
            session.ensurePrebufferSession();
            let wasActive = false;
            try {
              const ps = await session.parserSessionPromise;
              active++;
              wasActive = true;
              this.online = !!active;
              await ps.killed;
              this.console.error('prebuffer session ended');
            }
            catch (e) {
              this.console.error('prebuffer session ended with error', e);
            }
            finally {
              if (wasActive)
                active--;
              wasActive = false;
              this.online = !!active;
            }
            this.console.log('restarting prebuffer session in 5 seconds');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          this.console.log('exiting prebuffer session (released or restarted with new configuration)');
        })();
      }
    }

    if (!this.sessions.has(undefined)) {
      const defaultStreamName = this.streamSettings.storageSettings.values.defaultStream;
      let defaultSession = this.sessions.get(msos?.find(mso => mso.name === defaultStreamName)?.id);
      if (!defaultSession)
        defaultSession = this.sessions.get(msos?.find(mso => mso.id === enabledIds[0])?.id);
      if (!defaultSession)
        defaultSession = this.sessions.get(msos?.find(mso => mso.id === ids?.[0])?.id);

      if (defaultSession) {
        this.sessions.set(undefined, defaultSession);
        this.console.log('Default Stream:', defaultSession.advertisedMediaStreamOptions.id, defaultSession.advertisedMediaStreamOptions.name);
      }
      else {
        this.console.warn('Unable to find Default Stream?');
      }
    }

    deviceManager.onMixinEvent(this.id, this.mixinProviderNativeId, ScryptedInterface.Settings, undefined);
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    settings.push(...await this.streamSettings.storageSettings.getSettings());

    for (const session of new Set([...this.sessions.values()])) {
      if (!session)
        continue;
      try {
        settings.push(...await session.getMixinSettings());
      }
      catch (e) {
        this.console.error('error in prebuffer session getMixinSettings', e);
      }
    }

    return settings;
  }

  async putMixinSetting(key: string, value: SettingValue): Promise<void> {
    if (this.streamSettings.storageSettings.settings[key])
      await this.streamSettings.storageSettings.putSetting(key, value);
    else
      this.storage.setItem(key, value?.toString());

    // no prebuffer change necessary if the setting is a transcoding hint.
    if (this.streamSettings.storageSettings.settings[key]?.group === 'Transcoding')
      return;

    const sessions = this.sessions;
    this.sessions = new Map();

    // kill and reinitiate the prebuffers.
    for (const session of sessions.values()) {
      session?.parserSessionPromise?.then(session => session.kill());
    }
    this.ensurePrebufferSessions();
  }

  getPrebufferedStreams(msos?: ResponseMediaStreamOptions[]) {
    return getPrebufferedStreams(this.streamSettings.storageSettings, msos);
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    const ret: ResponseMediaStreamOptions[] = await this.mixinDevice.getVideoStreamOptions() || [];
    let enabledStreams = this.getPrebufferedStreams(ret);

    for (const mso of ret) {
      if (this.sessions.get(mso.id)?.parserSession || enabledStreams.includes(mso))
        mso.prebuffer = prebufferDurationMs;
    }

    return ret;
  }

  setVideoStreamOptions(options: MediaStreamOptions): Promise<void> {
    const session = this.sessions.get(options.id);
    if (session && options?.video?.bitrate) {
      session.needBitrateReset = true;
      const maxBitrate = session.maxBitrate;
      if (maxBitrate && options?.video?.bitrate > maxBitrate) {
        this.console.log('clamping max bitrate request', options.video.bitrate, maxBitrate);
        options.video.bitrate = maxBitrate;
      }
    }
    return this.mixinDevice.setVideoStreamOptions(options);
  }

  async release() {
    this.console.log('prebuffer session releasing if started');
    this.released = true;
    for (const session of this.sessions.values()) {
      if (!session)
        continue;
      session.clearPrebuffers();
      session.parserSessionPromise?.then(parserSession => {
        this.console.log('prebuffer session released');
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

export class RebroadcastPlugin extends AutoenableMixinProvider implements MixinProvider, BufferConverter, Settings, DeviceProvider {
  storageSettings = new StorageSettings(this, {
    rebroadcastPort: {
      title: 'Rebroadcast Port',
      description: 'The port of the RTSP server that will rebroadcast your streams.',
      type: 'number',
    },
  });
  transcodeStorageSettings = new StorageSettings(this, {
    remoteStreamingBitrate: {
      title: 'Remote Streaming Bitrate',
      type: 'number',
      defaultValue: 1000000,
      description: 'The bitrate to use when remote streaming. This setting will only be used when transcoding or adaptive bitrate is enabled on a camera.',
    },
    h264EncoderArguments: {
      title: 'H264 Encoder Arguments',
      description: 'FFmpeg arguments used to encode h264 video. This is not camera specific and is used to setup the hardware accelerated encoder on your Scrypted server. This setting will only be used when transcoding is enabled on a camera.',
      choices: Object.keys(getH264EncoderArgs()),
      defaultValue: getH264EncoderArgs()[LIBX264_ENCODER_TITLE].join(' '),
      combobox: true,
      mapPut: (oldValue, newValue) => getH264EncoderArgs()[newValue]?.join(' ') || newValue || getH264EncoderArgs()[LIBX264_ENCODER_TITLE]?.join(' '),
    }
  });
  rtspServer: net.Server;
  currentMixins = new Map<string, PrebufferMixin>();

  constructor(nativeId?: string) {
    super(nativeId);

    this.fromMimeType = 'x-scrypted/x-rfc4571';
    this.toMimeType = ScryptedMimeTypes.FFmpegInput;

    // trigger the prebuffer. do this on next tick
    // to allow the mixins to spin up from this provider.
    process.nextTick(() => {
      for (const id of Object.keys(systemManager.getSystemState())) {
        const device = systemManager.getDeviceById<VideoCamera>(id);
        if (!device.mixins?.includes(this.id))
          continue;
        try {
          device.getVideoStreamOptions();
        }
        catch (e) {
          this.console.error('error triggering prebuffer', device.name, e);
        }
      }
    });

    // schedule restarts at 2am
    const midnight = millisUntilMidnight();
    const twoAM = midnight + 2 * 60 * 60 * 1000;
    this.log.i(`Rebroadcaster scheduled for restart at 2AM: ${Math.round(twoAM / 1000 / 60)} minutes`)
    setTimeout(() => deviceManager.requestRestart(), twoAM);

    this.startRtspServer();

    process.nextTick(() => {
      deviceManager.onDeviceDiscovered({
        nativeId: TRANSCODE_MIXIN_PROVIDER_NATIVE_ID,
        name: 'Transcoding',
        interfaces: [
          ScryptedInterface.Settings,
          ScryptedInterface.MixinProvider,
        ],
        type: ScryptedDeviceType.API,
      });
    });
  }

  getDevice(nativeId: string) {
    if (nativeId === TRANSCODE_MIXIN_PROVIDER_NATIVE_ID)
      return new TranscodeMixinProvider(this);
  }

  getSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }

  putSetting(key: string, value: SettingValue): Promise<void> {
    return this.storageSettings.putSetting(key, value);
  }

  startRtspServer() {
    closeQuiet(this.rtspServer);

    this.rtspServer = new net.Server(async (client) => {
      let prebufferSession: PrebufferSession;

      const server = new RtspServer(client, undefined, undefined, async (method, url, headers, rawMessage) => {
        server.checkRequest = undefined;

        const u = new URL(url);

        for (const id of this.currentMixins.keys()) {
          const mixin = this.currentMixins.get(id);
          for (const session of mixin.sessions.values()) {
            if (u.pathname.endsWith(session.rtspServerPath)) {
              server.console = session.console;
              prebufferSession = session;
              prebufferSession.ensurePrebufferSession();
              await prebufferSession.parserSessionPromise;
              server.sdp = await prebufferSession.sdp;
              return true;
            }
          }
        }

        return false;
      });

      this.console.log('RTSP Rebroadcast connection started.')
      server.console = this.console;

      try {
        await server.handlePlayback();
        const session = await prebufferSession.parserSessionPromise;

        const idrInterval = prebufferSession.getDetectedIdrInterval();
        const requestedPrebuffer = Math.max(4000, (idrInterval || 4000)) * 1.5;

        prebufferSession.handleRebroadcasterClient({
          requestedContainer: 'rtsp',
          isActiveClient: true,
          container: 'rtsp',
          session,
          socketPromise: Promise.resolve(client),
          requestedPrebuffer,
        });

        await server.handleTeardown();
      }
      catch (e) {
        client.destroy();
      }
      this.console.log('RTSP Rebroadcast connection finished.')
    });

    if (!this.storageSettings.values.rebroadcastPort)
      this.storageSettings.values.rebroadcastPort = Math.round(Math.random() * 10000 + 30000);

    this.rtspServer.listen(this.storageSettings.values.rebroadcastPort);
  }

  async convert(data: Buffer, fromMimeType: string, toMimeType: string): Promise<Buffer> {
    const json = JSON.parse(data.toString());
    const { url, sdp } = json;

    const parsedSdp = parseSdp(sdp);
    const trackLookups = new Map<number, string>();
    for (const msection of parsedSdp.msections) {
      for (const pt of msection.payloadTypes) {
        trackLookups.set(pt, msection.control);
      }
    }

    const u = new URL(url);
    if (!u.protocol.startsWith('tcp'))
      throw new Error('rfc4751 url must be tcp');
    const { clientPromise, url: clientUrl } = await listenZeroSingleClient();
    const ffmpeg: FFmpegInput = {
      url: clientUrl,
      inputArguments: [
        "-rtsp_transport", "tcp",
        '-i', clientUrl.replace('tcp', 'rtsp'),
      ]
    };

    clientPromise.then(async (client) => {
      const rtsp = new RtspServer(client, sdp);
      //rtsp.console = this.console;
      await rtsp.handlePlayback();
      const socket = net.connect(parseInt(u.port), u.hostname);

      client.on('close', () => {
        socket.destroy();
      });
      socket.on('close', () => {
        client.destroy();
      })

      while (true) {
        const header = await readLength(socket, 2);
        const length = header.readInt16BE(0);
        const data = await readLength(socket, length);
        const pt = data[1] & 0x7f;
        const track = trackLookups.get(pt);
        if (!track) {
          client.destroy();
          socket.destroy();
          throw new Error('unknown payload type ' + pt);
        }
        rtsp.sendTrack(track, data, false);
      }
    });

    return Buffer.from(JSON.stringify(ffmpeg));
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.VideoCamera))
      return null;
    const ret = [ScryptedInterface.VideoCamera, ScryptedInterface.Settings, ScryptedInterface.Online, REBROADCAST_MIXIN_INTERFACE_TOKEN];
    if (interfaces.includes(ScryptedInterface.VideoCameraConfiguration))
      ret.push(ScryptedInterface.VideoCameraConfiguration);
    return ret;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    this.setHasEnabledMixin(mixinDeviceState.id);
    const ret = new PrebufferMixin(this, {
      mixinDevice,
      mixinDeviceState,
      mixinProviderNativeId: this.nativeId,
      mixinDeviceInterfaces,
      group: "Stream Management",
      groupKey: "prebuffer",
    });
    this.currentMixins.set(mixinDeviceState.id, ret);
    return ret;
  }

  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.online = true;
    await mixinDevice.release();
    this.currentMixins.delete(id);
  }
}

export default new RebroadcastPlugin();
