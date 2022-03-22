
import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, MediaStreamOptions, Settings, Setting, ScryptedMimeTypes, FFMpegInput, RequestMediaStreamOptions, BufferConverter, ResponseMediaStreamOptions, VideoCameraConfiguration } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { once } from 'events';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import { handleRebroadcasterClient, ParserOptions, ParserSession, setupActivityTimer, startParserSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { createMpegTsParser, createFragmentedMp4Parser, StreamChunk, StreamParser, MP4Atom, parseMp4StreamChunks } from '@scrypted/common/src/stream-parser';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { startFFMPegFragmentedMP4Session } from '@scrypted/common/src/ffmpeg-mp4-parser-session';
import { closeQuiet, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { parsePayloadTypes, parseTrackIds } from '@scrypted/common/src/sdp-utils';
import { createRtspParser, RtspClient, RtspServer } from '@scrypted/common/src/rtsp-server';
import { Duplex } from 'stream';
import net from 'net';
import { readLength } from '@scrypted/common/src/read-stream';
import { StorageSettings } from '@scrypted/common/src/settings';
import { addTrackControls } from '@scrypted/common/src/sdp-utils';
import { connectRFC4571Parser, startRFC4571Parser } from './rfc4571';
import { sleep } from '@scrypted/common/src/sleep';
import crypto from 'crypto';

const { mediaManager, log, systemManager, deviceManager } = sdk;

const defaultPrebufferDuration = 10000;
const PREBUFFER_DURATION_MS = 'prebufferDuration';
const SEND_KEYFRAME = 'sendKeyframe';
const DEFAULT_AUDIO = 'Default';
const AAC_AUDIO = 'AAC or No Audio';
const AAC_AUDIO_DESCRIPTION = `${AAC_AUDIO} (Copy)`;
const COMPATIBLE_AUDIO = 'Compatible Audio'
const COMPATIBLE_AUDIO_DESCRIPTION = `${COMPATIBLE_AUDIO} (Copy)`;
const TRANSCODE_AUDIO = 'Other Audio';
const TRANSCODE_AUDIO_DESCRIPTION = `${TRANSCODE_AUDIO} (Transcode)`;
const COMPATIBLE_AUDIO_CODECS = ['aac', 'mp3', 'mp2', 'opus'];
const DEFAULT_FFMPEG_INPUT_ARGUMENTS = '-fflags +genpts';

const SCRYPTED_PARSER = 'Scrypted';
const FFMPEG_PARSER = 'FFmpeg';
const STRING_DEFAULT = 'Default';

const VALID_AUDIO_CONFIGS = [
  AAC_AUDIO,
  COMPATIBLE_AUDIO,
  TRANSCODE_AUDIO,
];

interface PrebufferStreamChunk {
  chunk: StreamChunk;
  time: number;
}

interface Prebuffers {
  mp4: PrebufferStreamChunk[];
  mpegts: PrebufferStreamChunk[];
  rtsp: PrebufferStreamChunk[];
}

type PrebufferParsers = 'mpegts' | 'mp4' | 'rtsp';
const PrebufferParserValues: PrebufferParsers[] = ['mpegts', 'mp4', 'rtsp'];

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

  detectedIdrInterval = 0;
  prevIdr = 0;
  audioDisabled = false;

  mixinDevice: VideoCamera & VideoCameraConfiguration;
  console: Console;
  storage: Storage;

  activeClients = 0;
  inactivityTimeout: NodeJS.Timeout;
  audioConfigurationKey: string;
  ffmpegInputArgumentsKey: string;
  lastDetectedAudioCodecKey: string;
  rebroadcastModeKey: string;
  rtspParserKey: string;
  maxBitrateKey: string;
  rtspServerPath: string;
  needBitrateReset = false;

  constructor(public mixin: PrebufferMixin, public advertisedMediaStreamOptions: MediaStreamOptions, public stopInactive: boolean) {
    this.storage = mixin.storage;
    this.console = mixin.console;
    this.mixinDevice = mixin.mixinDevice;
    this.audioConfigurationKey = 'audioConfiguration-' + this.streamId;
    this.ffmpegInputArgumentsKey = 'ffmpegInputArguments-' + this.streamId;
    this.rebroadcastModeKey = 'rebroadcastMode-' + this.streamId;
    this.lastDetectedAudioCodecKey = 'lastDetectedAudioCodec-' + this.streamId;
    this.rtspParserKey = 'rtspParser-' + this.streamId;
    const rtspServerPathKey = 'rtspServerPathKey-' + this.streamId;
    this.maxBitrateKey = 'maxBitrate-' + this.streamId;

    this.rtspServerPath = this.storage.getItem(rtspServerPathKey);
    if (!this.rtspServerPath) {
      this.rtspServerPath = crypto.randomBytes(8).toString('hex');
      this.storage.setItem(rtspServerPathKey, this.rtspServerPath);
    }
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

  canUseRtspParser(muxingMp4: boolean, mediaStreamOptions: MediaStreamOptions) {
    if (muxingMp4)
      return false;
    if (mediaStreamOptions?.container !== 'rtsp')
      return false;
    // The RTSP demuxer can only be used when not transcoding audio.
    const { isUsingDefaultAudioConfig, compatibleAudio, aacAudio } = this.getAudioConfig();
    const canUseRtspParser = isUsingDefaultAudioConfig || compatibleAudio || aacAudio;
    return canUseRtspParser;
  }

  getParser(rtspMode: boolean, muxingMp4: boolean, mediaStreamOptions: MediaStreamOptions) {
    if (!this.canUseRtspParser(muxingMp4, mediaStreamOptions))
      return FFMPEG_PARSER;

    const defaultValue = rtspMode
      && mediaStreamOptions?.tool === 'scrypted' ?
      SCRYPTED_PARSER : FFMPEG_PARSER;
    const rtspParser = this.storage.getItem(this.rtspParserKey);
    if (!rtspParser || rtspParser === STRING_DEFAULT)
      return defaultValue;
    if (rtspParser === SCRYPTED_PARSER)
      return SCRYPTED_PARSER;
    if (rtspParser === FFMPEG_PARSER)
      return FFMPEG_PARSER;
    return defaultValue;
  }

  getRebroadcastMode() {
    let mode = this.storage.getItem(this.rebroadcastModeKey) || 'Default';
    let defaultMode = 'MPEG-TS';
    if (this.advertisedMediaStreamOptions?.tool === 'scrypted'
      && this.advertisedMediaStreamOptions?.container?.startsWith('rtsp')) {
      defaultMode = 'RTSP';
    }
    if (mode === 'Default') {
      mode = defaultMode;
    }
    const rtspMode = mode?.startsWith('RTSP');

    return {
      defaultMode,
      rtspMode: mode?.startsWith('RTSP'),
      muxingMp4: !rtspMode || mode?.includes('MP4'),
    };
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    const session = this.parserSession;

    let total = 0;
    let start = 0;
    const { muxingMp4, rtspMode, defaultMode } = this.getRebroadcastMode();
    for (const prebuffer of (muxingMp4 ? this.prebuffers.mp4 : this.prebuffers.rtsp)) {
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
          AAC_AUDIO_DESCRIPTION,
          COMPATIBLE_AUDIO_DESCRIPTION,
          TRANSCODE_AUDIO_DESCRIPTION,
        ],
      },
      {
        title: 'Rebroadcast Container',
        group,
        description: `Experimental: The container format to use when rebroadcasting. MPEG-TS is stable. RTSP is lower latency. The default mode for this camera is ${defaultMode}.`,
        placeholder: 'MPEG-TS',
        choices: [
          STRING_DEFAULT,
          'MPEG-TS',
          'RTSP',
          // 'RTSP+MP4',
        ],
        key: this.rebroadcastModeKey,
        value: this.storage.getItem(this.rebroadcastModeKey) || STRING_DEFAULT,
      }
    );

    const addFFmpegInputArgumentsSettings = () => {
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
    };


    if (this.canUseRtspParser(muxingMp4, this.advertisedMediaStreamOptions)
      && rtspMode
      && this.advertisedMediaStreamOptions?.container === 'rtsp') {

      const value = this.getParser(rtspMode, muxingMp4, this.advertisedMediaStreamOptions);

      settings.push(
        {
          key: this.rtspParserKey,
          group,
          title: 'RTSP Parser',
          description: `Experimental: The RTSP Parser used to read the stream. FFmpeg is stable. The Scrypted parser is lower latency. The Scrypted Parser is only available when the Audo Codec is not Transcoding and the Rebroadcast Container is RTSP. The default is "${value}" for this camera.`,
          value: this.storage.getItem(this.rtspParserKey) || STRING_DEFAULT,
          choices: [
            STRING_DEFAULT,
            FFMPEG_PARSER,
            SCRYPTED_PARSER,
          ],
        }
      );

      if (value !== SCRYPTED_PARSER) {
        // ffmpeg parser is being used, so add ffmpeg input arguments option.
        addFFmpegInputArgumentsSettings();
      }
    }
    else {
      addFFmpegInputArgumentsSettings();
    }

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
          value: (this.detectedIdrInterval || 0) / 1000 || 'unknown',
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
    const prebufferDurationMs = parseInt(this.storage.getItem(PREBUFFER_DURATION_MS)) || defaultPrebufferDuration;

    let mso: MediaStreamOptions;
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

    const { rtspMode, muxingMp4 } = this.getRebroadcastMode();

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

    // complain to the user about the codec if necessary. upstream may send a audio
    // stream but report none exists (to request muting).
    if (!audioSoftMuted && advertisedAudioCodec && detectedAudioCodec !== undefined
      && detectedAudioCodec !== advertisedAudioCodec) {
      this.console.warn('Audio codec plugin reported vs detected mismatch', advertisedAudioCodec, detectedAudioCodec);
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
          log.a(`${this.mixin.name} is using the ${assumedAudioCodec} audio codec. Configuring your Camera to use AAC, MP3, MP2, or Opus audio is recommended. If this is not possible, Select 'Transcode Audio' in the camera stream's Rebroadcast settings to suppress this alert.`);
        }
        this.console.warn('Configure your camera to output AAC, MP3, MP2, or Opus audio. Suboptimal audio codec in use:', assumedAudioCodec);
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
    if (!probingAudioCodec && isUsingDefaultAudioConfig && audioIncompatible) {
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
        acodec: isUsingDefaultAudioConfig
          ? ['-acodec', 'copy']
          : acodec,
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

    if (rtspMode && isRfc4571) {
      usingScryptedParser = true;
      this.console.log('bypassing ffmpeg: using scrypted rfc4571 parser')
      const json = await mediaManager.convertMediaObjectToJSON<any>(mo, 'x-scrypted/x-rfc4571');
      const { url, sdp, mediaStreamOptions } = json;

      session = await startRFC4571Parser(this.console, connectRFC4571Parser(url), sdp, mediaStreamOptions, false, rbo);
      this.sdp = session.sdp.then(buffers => Buffer.concat(buffers).toString());
    }
    else {
      const moBuffer = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.FFmpegInput);
      const ffmpegInput = JSON.parse(moBuffer.toString()) as FFMpegInput;
      sessionMso = ffmpegInput.mediaStreamOptions;

      const parser = this.getParser(rtspMode, muxingMp4, ffmpegInput.mediaStreamOptions);
      if (parser === SCRYPTED_PARSER) {
        usingScryptedParser = true;
        this.console.log('bypassing ffmpeg: using scrypted rtsp/rfc4571 parser');
        const rtspClient = new RtspClient(ffmpegInput.url, this.console);
        try {
          rtspClient.requestTimeout = 10000;
          await rtspClient.options();
          const sdpResponse = await rtspClient.describe();
          const sdp = sdpResponse.body.toString().trim();
          this.console.log('sdp', sdp);
          this.sdp = Promise.resolve(sdp);
          const { audio, video } = parseTrackIds(sdp);
          let channel = 0;
          if (!audioSoftMuted) {
            await rtspClient.setup(channel, audio);
            channel += 2;
          }
          await rtspClient.setup(channel, video);
          const socket = await rtspClient.play();
          session = await startRFC4571Parser(this.console, socket, sdp, ffmpegInput.mediaStreamOptions, true, rbo);
          const sessionKill = session.kill.bind(session);
          session.kill = async () => {
            // issue a teardown to upstream to close gracefully but don't rely on it responding.
            rtspClient.teardown().finally(sessionKill);
            await sleep(500);
            sessionKill();
          }
        }
        catch (e) {
          rtspClient.client.destroy();
          throw e;
        }
      }
      else {
        // create missing pts from dts so mpegts and mp4 muxing does not fail
        const extraInputArguments = this.storage.getItem(this.ffmpegInputArgumentsKey) || DEFAULT_FFMPEG_INPUT_ARGUMENTS;
        ffmpegInput.inputArguments.unshift(...extraInputArguments.split(' '));
        session = await startParserSession(ffmpegInput, rbo);
      }
    }

    // if operating in RTSP mode, use a side band ffmpeg process to grab the mp4 segments.
    // ffmpeg adds latency, as well as rewrites timestamps.
    if (usingScryptedParser && muxingMp4) {
      this.getVideoStream({
        id: this.streamId,
        refresh: false,
      })
        .then(async (stream) => {
          const extraInputArguments = this.storage.getItem(this.ffmpegInputArgumentsKey) || DEFAULT_FFMPEG_INPUT_ARGUMENTS;
          const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFMpegInput>(stream, ScryptedMimeTypes.FFmpegInput);
          ffmpegInput.inputArguments.unshift(...extraInputArguments.split(' '));
          const mp4Session = await startFFMPegFragmentedMP4Session(ffmpegInput.inputArguments, acodec, vcodec, this.console);

          const kill = () => {
            mp4Session.cp.kill('SIGKILL');
            session.kill();
            mp4Session.generator.throw(new Error('killed'));
          };

          if (!session.isActive) {
            kill();
            return;
          }

          session.once('killed', kill);

          const { resetActivityTimer } = setupActivityTimer('mp4', kill, session, rbo.timeout);

          for await (const chunk of parseMp4StreamChunks(mp4Session.generator)) {
            resetActivityTimer();
            session.emit('mp4', chunk);
          }
        })
        .catch(() => { });
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
        const ffmpegInput = JSON.parse(moBuffer.toString()) as FFMpegInput;
        mso = ffmpegInput.mediaStreamOptions;

        scheduleRefresh(mso);
      };

      const scheduleRefresh = (refreshMso: ResponseMediaStreamOptions) => {
        const when = refreshMso.refreshAt - Date.now() - 30000;
        this.console.log('refreshing media stream in', when);
        refreshTimeout = setTimeout(refreshStream, when);
      }

      scheduleRefresh(mso);
      session.once('killed', () => clearTimeout(refreshTimeout));
    }

    session.once('killed', () => {
      clearTimeout(this.inactivityTimeout)
      this.parserSessionPromise = undefined;
      if (this.parserSession === session)
        this.parserSession = undefined;
    });

    for (const container of PrebufferParserValues) {
      let shifts = 0;

      session.on(container, (chunk: StreamChunk) => {
        const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];
        const now = Date.now();

        const updateIdr = () => {
          if (this.prevIdr) {
            const sendEvent = !this.detectedIdrInterval;
            this.detectedIdrInterval = now - this.prevIdr;
            // only on the first idr update should we send a settings refresh.
            if (sendEvent)
              deviceManager.onMixinEvent(this.mixin.id, this.mixin.mixinProviderNativeId, ScryptedInterface.Settings, undefined);
          }
          this.prevIdr = now;
        }

        // this is only valid for mp4, so its no op for everything else
        // used to detect idr interval.
        if (chunk.type === 'mdat') {
          updateIdr();
        }
        if (chunk.type === 'rtp-video') {
          const fragmentType = chunk.chunks[1].readUInt8(12) & 0x1f;
          const second = chunk.chunks[1].readUInt8(13);
          const nalType = second & 0x1f;
          const startBit = second & 0x80;
          if (((fragmentType === 28 || fragmentType === 29) && nalType === 5 && startBit == 128) || fragmentType == 5) {
            updateIdr();
          }
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
    if (this.activeClients)
      return;

    if (this.needBitrateReset && this.mixin.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCameraConfiguration)) {
        this.resetBitrate();
    }

    if (!this.stopInactive) {
      return;
    }

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
    isActiveClient: boolean,
    container: PrebufferParsers,
    session: ParserSession<PrebufferParsers>,
    socketPromise: Promise<Duplex>,
    requestedPrebuffer: number,
  }) {
    const { isActiveClient, container, session, socketPromise, requestedPrebuffer } = options;

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

        const safeWriteData = (chunk: StreamChunk) => {
          const buffered = writeData(chunk);
          if (buffered > 100000000) {
            this.console.log('more than 100MB has been buffered, did downstream die? killing connection.', this.streamName);
            cleanup();
          }
        }

        const cleanup = () => {
          destroy();
          session.removeListener(container, safeWriteData);
          session.removeListener('killed', cleanup);
        }

        session.on(container, safeWriteData);
        session.once('killed', cleanup);

        const prebufferContainer: PrebufferStreamChunk[] = this.prebuffers[container];
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
          if (isActiveClient) {
            this.activeClients--;
            this.inactivityCheck(session);
          }
          else {
            // this.console.log('passive client request ended');
          }
          cleanup();
        };
      }
    })
  }

  async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
    this.ensurePrebufferSession();

    const session = await this.parserSessionPromise;

    const sendKeyframe = this.storage.getItem(SEND_KEYFRAME) !== 'false';
    let requestedPrebuffer = options?.prebuffer;
    if (requestedPrebuffer == null) {
      if (sendKeyframe) {
        // get into the general area of finding a sync frame.
        requestedPrebuffer = Math.max(4000, (this.detectedIdrInterval || 4000)) * 1.5;
      }
      else {
        requestedPrebuffer = 0;
      }
    }

    const { rtspMode } = this.getRebroadcastMode();
    const defaultContainer = rtspMode ? 'rtsp' : 'mpegts';

    let container: PrebufferParsers = this.parsers[options?.container] ? options?.container as PrebufferParsers : defaultContainer;

    // If a mp4 prebuffer was explicitly requested, but an mp4 prebuffer is not available (rtsp mode),
    // rewind a little bit earlier to gaurantee a valid full segment of that length is sent.
    if (options?.prebuffer && container !== 'mp4' && options?.container === 'mp4') {
      requestedPrebuffer += (this.detectedIdrInterval || 4000) * 1.5;
    }

    const createContainerServer = async (container: PrebufferParsers) => {

      let socketPromise: Promise<Duplex>;
      let containerUrl: string;

      if (container === 'rtsp') {
        const client = await listenZeroSingleClient();
        socketPromise = client.clientPromise.then(async (socket) => {
          let sdp = await this.sdp;
          sdp = addTrackControls(sdp);
          const server = new RtspServer(socket, sdp);
          //server.console = this.console;
          await server.handlePlayback();
          return socket;
        })
        containerUrl = client.url.replace('tcp://', 'rtsp://');
      }
      else {
        const client = await listenZeroSingleClient();
        socketPromise = client.clientPromise;
        containerUrl = `tcp://127.0.0.1:${client.port}`
      }

      const isActiveClient = options?.refresh !== false;

      this.handleRebroadcasterClient({
        isActiveClient,
        container,
        requestedPrebuffer,
        socketPromise,
        session,
      });

      return containerUrl;
    }

    const mediaStreamOptions: MediaStreamOptions = Object.assign({}, session.mediaStreamOptions);

    mediaStreamOptions.prebuffer = requestedPrebuffer;

    const { reencodeAudio } = this.getAudioConfig();

    let codecCopy = false;
    if (this.audioDisabled) {
      mediaStreamOptions.audio = null;
    }
    else if (reencodeAudio) {
      mediaStreamOptions.audio = {
        codec: 'aac',
        encoder: 'aac',
        profile: 'aac_low',
      }
    }
    else {
      codecCopy = true;
    }

    if (codecCopy) {
      // reported codecs may be wrong/cached/etc, so before blindly copying the audio codec info,
      // verify what was found.
      if (session?.mediaStreamOptions?.audio?.codec === session?.inputAudioCodec) {
        mediaStreamOptions.audio = session?.mediaStreamOptions?.audio;
      }
      else {
        mediaStreamOptions.audio = {
          codec: session?.inputAudioCodec,
        }
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

    const url = await createContainerServer(container);
    const ffmpegInput: FFMpegInput = {
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

    const mo = mediaManager.createFFmpegMediaObject(ffmpegInput);
    return mo;
  }
}

class PrebufferMixin extends SettingsMixinDeviceBase<VideoCamera & VideoCameraConfiguration> implements VideoCamera, Settings, VideoCameraConfiguration {
  released = false;
  sessions = new Map<string, PrebufferSession>();

  constructor(public plugin: PrebufferProvider, options: SettingsMixinDeviceOptions<VideoCamera & VideoCameraConfiguration>) {
    super(options);

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
        const notEnabled = !enabledIds.includes(id)
        const stopInactive = isBatteryPowered || notEnabled;
        session = new PrebufferSession(this, mso, stopInactive);
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
            let wasActive = false;
            try {
              const ps = await session.parserSessionPromise;
              active++;
              wasActive = true;
              this.online = !!active;
              await once(ps, 'killed');
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

    for (const mso of ret) {
      if (this.sessions.get(mso.id)?.parserSession || enabledStreams.includes(mso))
        mso.prebuffer = prebuffer;
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

class PrebufferProvider extends AutoenableMixinProvider implements MixinProvider, BufferConverter {
  storageSettings = new StorageSettings(this, {
    rebroadcastPort: {
      title: 'Rebroadcast Port',
      description: 'The port of the RTSP server that will rebroadcast your streams.',
      type: 'number',
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

        const requestedPrebuffer = Math.max(4000, (prebufferSession.detectedIdrInterval || 4000)) * 1.5;

        prebufferSession.handleRebroadcasterClient({
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

    const { audioPayloadTypes, videoPayloadTypes } = parsePayloadTypes(sdp);

    const u = new URL(url);
    if (!u.protocol.startsWith('tcp'))
      throw new Error('rfc4751 url must be tcp');
    const { clientPromise, url: clientUrl } = await listenZeroSingleClient();
    const ffmpeg: FFMpegInput = {
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
        if (audioPayloadTypes.has(pt)) {
          rtsp.sendAudio(data, false);
        }
        else if (videoPayloadTypes.has(pt)) {
          rtsp.sendVideo(data, false);
        }
        else {
          client.destroy();
          socket.destroy();
          throw new Error('unknown payload type ' + pt);
        }
      }
    })

    return Buffer.from(JSON.stringify(ffmpeg));
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.VideoCamera))
      return null;
    const ret = [ScryptedInterface.VideoCamera, ScryptedInterface.Settings, ScryptedInterface.Online];
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
      group: "Prebuffer Settings",
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

export default new PrebufferProvider();
