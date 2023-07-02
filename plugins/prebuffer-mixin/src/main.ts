
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { getDebugModeH264EncoderArgs, getH264EncoderArgs } from '@scrypted/common/src/ffmpeg-hardware-acceleration';
import { addVideoFilterArguments } from '@scrypted/common/src/ffmpeg-helpers';
import { ParserOptions, ParserSession, handleRebroadcasterClient, startParserSession } from '@scrypted/common/src/ffmpeg-rebroadcast';
import { ListenZeroSingleClientTimeoutError, closeQuiet, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { readLength } from '@scrypted/common/src/read-stream';
import { H264_NAL_TYPE_FU_B, H264_NAL_TYPE_IDR, H264_NAL_TYPE_MTAP16, H264_NAL_TYPE_MTAP32, H264_NAL_TYPE_RESERVED0, H264_NAL_TYPE_RESERVED30, H264_NAL_TYPE_RESERVED31, H264_NAL_TYPE_SEI, H264_NAL_TYPE_STAP_B, RtspServer, RtspTrack, createRtspParser, findH264NaluType, getNaluTypes, listenSingleRtspClient } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import { sleep } from '@scrypted/common/src/sleep';
import { StreamChunk, StreamParser } from '@scrypted/common/src/stream-parser';
import sdk, { BufferConverter, ChargeState, DeviceProvider, DeviceState, EventListenerRegister, FFmpegInput, H264Info, MediaObject, MediaStreamDestination, MediaStreamOptions, MixinProvider, RequestMediaStreamOptions, ResponseMediaStreamOptions, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, SettingValue, Settings, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import { once } from 'events';
import net, { AddressInfo } from 'net';
import semver from 'semver';
import { Duplex } from 'stream';
import { Worker } from 'worker_threads';
import { FileRtspServer } from './file-rtsp-server';
import { getUrlLocalAdresses } from './local-addresses';
import { REBROADCAST_MIXIN_INTERFACE_TOKEN } from './rebroadcast-mixin-token';
import { connectRFC4571Parser, startRFC4571Parser } from './rfc4571';
import { RtspSessionParserSpecific, startRtspSession } from './rtsp-session';
import { createStreamSettings } from './stream-settings';
import { TRANSCODE_MIXIN_PROVIDER_NATIVE_ID, TranscodeMixinProvider, getTranscodeMixinProviderId } from './transcode-settings';

const { mediaManager, log, systemManager, deviceManager } = sdk;

const prebufferDurationMs = 10000;
const DEFAULT_FFMPEG_INPUT_ARGUMENTS = '-fflags +genpts';

const SCRYPTED_PARSER_TCP = 'Scrypted (TCP)';
const SCRYPTED_PARSER_UDP = 'Scrypted (UDP)';
const FFMPEG_PARSER_TCP = 'FFmpeg (TCP)';
const FFMPEG_PARSER_UDP = 'FFmpeg (UDP)';
const STRING_DEFAULT = 'Default';

interface PrebufferStreamChunk extends StreamChunk {
  time?: number;
}

type Prebuffers<T extends string> = {
  [key in T]: PrebufferStreamChunk[];
}

type PrebufferParsers = 'rtsp';
const PrebufferParserValues: PrebufferParsers[] = ['rtsp'];

function hasOddities(h264Info: H264Info) {
  const h264Oddities = h264Info.fuab
    || h264Info.mtap16
    || h264Info.mtap32
    || h264Info.sei
    || h264Info.stapb
    || h264Info.reserved0
    || h264Info.reserved30
    || h264Info.reserved31;
  return h264Oddities;
}

class PrebufferSession {

  parserSessionPromise: Promise<ParserSession<PrebufferParsers>>;
  parserSession: ParserSession<PrebufferParsers>;
  prebuffers: Prebuffers<PrebufferParsers> = {
    rtsp: [],
  };
  parsers: { [container: string]: StreamParser };
  sdp: Promise<string>;
  usingScryptedParser = false;
  usingScryptedUdpParser = false;

  audioDisabled = false;

  mixinDevice: VideoCamera;
  console: Console;
  storage: Storage;

  activeClients = 0;
  inactivityTimeout: NodeJS.Timeout;
  audioConfigurationKey: string;
  ffmpegInputArgumentsKey: string;
  ffmpegOutputArgumentsKey: string;
  lastDetectedAudioCodecKey: string;
  lastH264ProbeKey: string;
  rtspParserKey: string;
  rtspServerPath: string;
  rtspServerMutedPath: string;

  batteryListener: EventListenerRegister;
  chargerListener: EventListenerRegister;

  constructor(public mixin: PrebufferMixin, public advertisedMediaStreamOptions: ResponseMediaStreamOptions, public enabled: boolean, public forceBatteryPrebuffer: boolean) {
    this.storage = mixin.storage;
    this.console = mixin.console;
    this.mixinDevice = mixin.mixinDevice;
    this.audioConfigurationKey = 'audioConfiguration-' + this.streamId;
    this.ffmpegInputArgumentsKey = 'ffmpegInputArguments-' + this.streamId;
    this.ffmpegOutputArgumentsKey = 'ffmpegOutputArguments-' + this.streamId;
    this.lastDetectedAudioCodecKey = 'lastDetectedAudioCodec-' + this.streamId;
    this.lastH264ProbeKey = 'lastH264Probe-' + this.streamId;
    this.rtspParserKey = 'rtspParser-' + this.streamId;
    const rtspServerPathKey = 'rtspServerPathKey-' + this.streamId;
    const rtspServerMutedPathKey = 'rtspServerMutedPathKey-' + this.streamId;

    this.rtspServerPath = this.storage.getItem(rtspServerPathKey);
    if (!this.rtspServerPath) {
      this.rtspServerPath = crypto.randomBytes(8).toString('hex');
      this.storage.setItem(rtspServerPathKey, this.rtspServerPath);
    }

    this.rtspServerMutedPath = this.storage.getItem(rtspServerMutedPathKey);
    if (!this.rtspServerMutedPath) {
      this.rtspServerMutedPath = crypto.randomBytes(8).toString('hex');
      this.storage.setItem(rtspServerMutedPathKey, this.rtspServerMutedPath);
    }

    this.handleChargingBatteryEvents();
  }

  get stopInactive() {
    return !this.enabled || this.shouldDisableBatteryPrebuffer();
  }

  get canPrebuffer() {
    return this.advertisedMediaStreamOptions.container !== 'rawvideo' && this.advertisedMediaStreamOptions.container !== 'ffmpeg';
  }

  getLastH264Probe(): H264Info {
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

  getLastH264Oddities() {
    return hasOddities(this.getLastH264Probe());
  }

  getDetectedIdrInterval() {
    const durations: number[] = [];
    if (this.prebuffers.rtsp.length) {
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

  get streamId() {
    return this.advertisedMediaStreamOptions.id;
  }

  get streamName() {
    return this.advertisedMediaStreamOptions.name || `Stream ${this.streamId}`;
  }

  clearPrebuffers() {
    for (const prebuffer of PrebufferParserValues) {
      this.prebuffers[prebuffer] = [];
    }
  }

  release() {
    this.clearPrebuffers();
    this.parserSessionPromise?.then(parserSession => {
      this.console.log(this.streamName, 'prebuffer session released');
      parserSession.kill(new Error('rebroadcast disabled'));
      this.clearPrebuffers();
    });
    if (this.batteryListener) {
      this.batteryListener.removeListener();
      this.batteryListener = null;
    }
    if (this.chargerListener) {
      this.chargerListener.removeListener();
      this.chargerListener = null;
    }
  }

  ensurePrebufferSession() {
    if (this.parserSessionPromise || this.mixin.released)
      return;
    this.console.log(this.streamName, 'prebuffer session started');
    this.parserSessionPromise = this.startPrebufferSession();
    this.parserSessionPromise.catch(e => {
      this.console.error(this.streamName, 'prebuffer session ended with error', e);
      this.parserSessionPromise = undefined;
    });
    this.parserSessionPromise.then(pso => pso.killed.finally(() => {
      this.console.error(this.streamName, 'prebuffer session ended');
      this.parserSessionPromise = undefined;
    }));
  }

  canUseRtspParser(mediaStreamOptions: MediaStreamOptions) {
    return mediaStreamOptions?.container?.startsWith('rtsp');
  }

  getParser(mediaStreamOptions: MediaStreamOptions) {
    let parser: string;
    const rtspParser = this.storage.getItem(this.rtspParserKey);

    if (!this.canUseRtspParser(mediaStreamOptions)) {
      parser = STRING_DEFAULT;
    }
    else {
      switch (rtspParser) {
        case FFMPEG_PARSER_TCP:
        case FFMPEG_PARSER_UDP:
        case SCRYPTED_PARSER_TCP:
        case SCRYPTED_PARSER_UDP:
          parser = rtspParser;
          break;
        default:
          parser = SCRYPTED_PARSER_TCP;
          break;
      }
    }

    return {
      parser,
      isDefault: !rtspParser || rtspParser === 'Default',
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    const session = this.parserSession;

    let total = 0;
    let start = 0;
    for (const prebuffer of this.prebuffers.rtsp) {
      start = start || prebuffer.time;
      for (const chunk of prebuffer.chunks) {
        total += chunk.byteLength;
      }
    }
    const elapsed = Date.now() - start;
    const bitrate = Math.round(total / elapsed * 8);

    const group = "Streams";
    const subgroup = `Stream: ${this.streamName}`;

    const addFFmpegInputSettings = () => {
      settings.push(
        {
          title: 'FFmpeg Input Arguments Prefix',
          group,
          subgroup,
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
        {
          title: 'FFmpeg Output Arguments Prefix',
          group,
          subgroup,
          description: 'Optional/Advanced: Additional output arguments to pass to the ffmpeg command. These will be placed before the input arguments.',
          key: this.ffmpegOutputArgumentsKey,
          value: this.storage.getItem(this.ffmpegOutputArgumentsKey),
          choices: [
            '-vcodec h264 -bf 0'
          ],
          combobox: true,
        },
      )
    }

    let usingFFmpeg = true;

    if (this.canUseRtspParser(this.advertisedMediaStreamOptions)) {
      const parser = this.getParser(this.advertisedMediaStreamOptions);
      const defaultValue = parser.parser;

      const scryptedOptions = [
        SCRYPTED_PARSER_TCP,
        SCRYPTED_PARSER_UDP,
      ];

      const currentParser = parser.isDefault ? STRING_DEFAULT : parser.parser;

      settings.push(
        {
          key: this.rtspParserKey,
          group,
          subgroup,
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

      usingFFmpeg = !parser.parser.includes('Scrypted');
    }

    if (usingFFmpeg) {
      addFFmpegInputSettings();
    }

    const addOddities = () => {
      settings.push(
        {
          key: 'detectedOddities',
          group,
          subgroup,
          title: 'Detected H264 Oddities',
          readonly: true,
          value: JSON.stringify(this.getLastH264Probe()),
          description: 'Cameras with oddities in the H264 video stream may not function correctly with Scrypted RTSP Parsers or Senders.',
        }
      )
    };

    if (session) {
      const resolution = session.inputVideoResolution?.width && session.inputVideoResolution?.height
        ? `${session.inputVideoResolution?.width}x${session.inputVideoResolution?.height}`
        : 'unknown';

      const idrInterval = this.getDetectedIdrInterval();
      settings.push(
        {
          key: 'detectedResolution',
          group,
          subgroup,
          title: 'Detected Resolution and Bitrate',
          readonly: true,
          value: `${resolution} @ ${bitrate || "unknown"} Kb/s`,
          description: 'Configuring your camera to 1920x1080, 2000Kb/S, Variable Bit Rate, is recommended.',
        },
        {
          key: 'detectedCodec',
          group,
          subgroup,
          title: 'Detected Video/Audio Codecs',
          readonly: true,
          value: (session?.inputVideoCodec?.toString() || 'unknown') + '/' + (session?.inputAudioCodec?.toString() || 'unknown'),
          description: 'Configuring your camera to H264 video, and audio to Opus or PCM-mulaw (G.711ulaw) is recommended.'
        },
        {
          key: 'detectedKeyframe',
          group,
          subgroup,
          title: 'Detected Keyframe Interval',
          description: "Configuring your camera to 4 seconds is recommended (IDR aka Frame Interval = FPS * 4 seconds).",
          readonly: true,
          value: (idrInterval || 0) / 1000 || 'unknown',
        },
      );
      addOddities();
    }
    else {
      settings.push(
        {
          title: 'Status',
          group,
          subgroup,
          key: 'status',
          description: 'Rebroadcast is currently idle and will be started automatically on demand.',
          value: 'Idle',
          readonly: true,
        },
      );
      addOddities();
    }

    settings.push({
      group,
      subgroup,
      key: 'rtspRebroadcastUrl',
      title: 'RTSP Rebroadcast Url',
      description: 'The RTSP URL of the rebroadcast stream. Substitute localhost as appropriate.',
      readonly: true,
      value: `rtsp://localhost:${this.mixin.streamSettings.storageSettings.values.rebroadcastPort}/${this.rtspServerPath}`,
    });
    settings.push({
      group,
      subgroup,
      key: 'rtspRebroadcastMutedUrl',
      title: 'RTSP Rebroadcast Url (Muted)',
      description: 'The RTSP URL of the muted rebroadcast stream. Substitute localhost as appropriate.',
      readonly: true,
      value: `rtsp://localhost:${this.mixin.streamSettings.storageSettings.values.rebroadcastPort}/${this.rtspServerMutedPath}`,
    });

    return settings;
  }

  async startPrebufferSession() {
    this.clearPrebuffers();

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

    let detectedAudioCodec = this.storage.getItem(this.lastDetectedAudioCodecKey) || undefined;
    if (detectedAudioCodec === 'null')
      detectedAudioCodec = null;

    this.audioDisabled = false;
    let acodec: string[];

    if (audioSoftMuted) {
      // no audio? explicitly disable it.
      acodec = ['-an'];
      this.audioDisabled = true;
    }
    else {
      acodec = [
        '-acodec',
        'copy',
      ];
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


    const parser = createRtspParser({
      vcodec,
      // the rtsp parser should always stream copy unless audio is soft muted.
      acodec: audioSoftMuted ? acodec : ['-acodec', 'copy'],
    });
    this.sdp = parser.sdp;
    rbo.parsers.rtsp = parser;

    const mo = await this.mixinDevice.getVideoStream(mso);
    const isRfc4571 = mo.mimeType === 'x-scrypted/x-rfc4571';

    let session: ParserSession<PrebufferParsers>;
    let sessionMso: ResponseMediaStreamOptions;

    // before launching the parser session, clear out the last detected codec.
    // an erroneous cached codec could cause ffmpeg to fail to start.
    this.storage.removeItem(this.lastDetectedAudioCodecKey);
    this.usingScryptedParser = false;

    const h264Oddities = this.getLastH264Oddities();

    if (isRfc4571) {
      this.usingScryptedParser = true;
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

      let { parser, isDefault } = this.getParser(sessionMso);
      this.usingScryptedParser = parser === SCRYPTED_PARSER_TCP || parser === SCRYPTED_PARSER_UDP;
      this.usingScryptedUdpParser = parser === SCRYPTED_PARSER_UDP;

      // prefer ffmpeg if this is a prebuffered stream.
      if (isDefault
        && this.usingScryptedParser
        && h264Oddities
        && !this.stopInactive
        && sessionMso.tool !== 'scrypted') {
        this.console.warn('H264 oddities were detected in prebuffered video stream, the Default Scrypted RTSP Parser will not be used. Falling back to FFmpeg. This can be overriden by setting the RTSP Parser to Scrypted.');
        this.usingScryptedParser = false;
        parser = FFMPEG_PARSER_TCP;
      }

      if (this.usingScryptedParser) {
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
        const extraOutputArguments = this.storage.getItem(this.ffmpegOutputArgumentsKey) || '';
        ffmpegInput.inputArguments.unshift(...extraInputArguments.split(' '));
        rbo.parsers.rtsp.outputArguments.push(...extraOutputArguments.split(' ').filter(d => !!d));
        session = await startParserSession(ffmpegInput, rbo);
      }
    }

    if (this.usingScryptedParser) {
      // watch the stream for 10 seconds to see if an weird nalu is encountered.
      // if one is found and using scrypted parser as default, will need to restart rebroadcast to prevent
      // downstream issues.
      const h264Probe: H264Info = {};
      let reportedOddity = false;
      const oddityProbe = (chunk: StreamChunk) => {
        if (chunk.type !== 'h264')
          return;

        const types = getNaluTypes(chunk);
        h264Probe.fuab ||= types.has(H264_NAL_TYPE_FU_B);
        h264Probe.stapb ||= types.has(H264_NAL_TYPE_STAP_B);
        h264Probe.mtap16 ||= types.has(H264_NAL_TYPE_MTAP16);
        h264Probe.mtap32 ||= types.has(H264_NAL_TYPE_MTAP32);
        h264Probe.sei ||= types.has(H264_NAL_TYPE_SEI);
        h264Probe.reserved0 ||= types.has(H264_NAL_TYPE_RESERVED0);
        h264Probe.reserved30 ||= types.has(H264_NAL_TYPE_RESERVED30);
        h264Probe.reserved31 ||= types.has(H264_NAL_TYPE_RESERVED31);
        const oddity = hasOddities(h264Probe);
        if (oddity && !reportedOddity) {
          reportedOddity = true;
          let { isDefault } = this.getParser(sessionMso);
          this.console.warn('H264 oddity detected.');
          if (!isDefault) {
            this.console.warn('If there are issues streaming, consider using the Default parser.');
            return;
          }

          if (sessionMso.tool === 'scrypted') {
            this.console.warn('Stream tool is marked safe as "scrypted", ignoring oddity. If there are issues streaming, consider switching to FFmpeg parser.');
            return;
          }

          // don't restart the stream if it is not a prebuffered stream.
          // allow this specific request to continue, and possibly fail.
          // the next time the stream is requested, ffmpeg will be used.
          if (!this.stopInactive) {
            this.console.warn('Oddity in prebuffered stream. Restarting rebroadcast to use FFmpeg instead.');
            session.kill(new Error('restarting due to H264 oddity detection'));
            this.storage.setItem(this.lastH264ProbeKey, JSON.stringify(h264Probe));
            removeOddityProbe();
            this.startPrebufferSession();
            return;
          }

          // this.console.warn('Oddity in non prebuffered stream. Next restart will use FFmpeg instead.');
        }
      }
      const removeOddityProbe = () => session.removeListener('rtsp', oddityProbe);
      session.killed.finally(() => clearTimeout(oddityTimeout));
      session.on('rtsp', oddityProbe);
      const oddityTimeout = setTimeout(() => {
        removeOddityProbe();
        this.storage.setItem(this.lastH264ProbeKey, JSON.stringify(h264Probe));
      }, h264Oddities ? 60000 : 10000);
    }

    await session.sdp;

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

    // set/update the detected codec, set it to null if no audio was found.
    this.storage.setItem(this.lastDetectedAudioCodecKey, session.inputAudioCodec || 'null');

    if (session.inputVideoCodec !== 'h264') {
      this.console.error(`Video codec is not h264. If there are errors, try changing your camera's encoder output.`);
    }

    this.parserSession = session;
    session.killed.finally(() => {
      if (this.parserSession === session)
        this.parserSession = undefined;
    });
    session.killed.finally(() => clearTimeout(this.inactivityTimeout));

    // settings ui refresh
    deviceManager.onMixinEvent(this.mixin.id, this.mixin, ScryptedInterface.Settings, undefined);

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

    session.start();
    return session;
  }

  printActiveClients() {
    this.console.log(this.streamName, 'active rebroadcast clients:', this.activeClients);
  }

  inactivityCheck(session: ParserSession<PrebufferParsers>, resetTimeout: boolean) {
    if (this.activeClients)
      return;

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
      session.kill(new Error('stream inactivity'));
    }, 10000);
  }

  handleChargingBatteryEvents() {
    if (!this.mixin.interfaces.includes(ScryptedInterface.Charger) ||
      !this.mixin.interfaces.includes(ScryptedInterface.Battery)) {
      return;
    }

    const checkDisablePrebuffer = async () => {
      if (this.stopInactive) {
        this.console.log(this.streamName, 'low battery or not charging, prebuffering and rebroadcasting will only work on demand')
        if (!this.activeClients && this.parserSessionPromise) {
          this.console.log(this.streamName, 'terminating rebroadcast due to low battery or not charging')
          const session = await this.parserSessionPromise;
          session.kill(new Error('low battery or not charging'));
        }
      } else {
        this.ensurePrebufferSession();
      }
    }

    const id = this.mixin.id;
    if (!this.batteryListener) {
      this.batteryListener = systemManager.listenDevice(id, ScryptedInterface.Battery, () => checkDisablePrebuffer());
    }
    if (!this.chargerListener) {
      this.chargerListener = systemManager.listenDevice(id, ScryptedInterface.Charger, () => checkDisablePrebuffer());
    }
  }

  shouldDisableBatteryPrebuffer(): boolean | null {
    if (!this.mixin.interfaces.includes(ScryptedInterface.Battery)) {
      return null;
    }
    if (this.forceBatteryPrebuffer) {
      return false;
    }
    const lowBattery = this.mixin.batteryLevel == null || this.mixin.batteryLevel < 20;
    const hasCharger = this.mixin.interfaces.includes(ScryptedInterface.Charger);
    return !hasCharger || lowBattery || this.mixin.chargeState !== ChargeState.Charging;
  }

  async handleRebroadcasterClient(options: {
    findSyncFrame: boolean,
    isActiveClient: boolean,
    container: PrebufferParsers,
    session: ParserSession<PrebufferParsers>,
    socketPromise: Promise<Duplex>,
    requestedPrebuffer: number,
    filter?: (chunk: StreamChunk, prebuffer: boolean) => StreamChunk,
  }) {
    const { isActiveClient, container, session, socketPromise, requestedPrebuffer } = options;
    this.console.log('sending prebuffer', requestedPrebuffer);

    let socket: Duplex;

    try {
      socket = await socketPromise;
    }
    catch (e) {
      // in case the client never connects, do an inactivity check.
      this.inactivityCheck(session, false);
      if (e instanceof ListenZeroSingleClientTimeoutError)
        this.console.warn('client connection timed out');
      else
        this.console.error('client connection error', e);
      return;
    }

    if (isActiveClient) {
      this.activeClients++;
      this.printActiveClients();
    }

    socket.once('close', () => {
      if (isActiveClient) {
        this.activeClients--;
        this.printActiveClients();
      }
      this.inactivityCheck(session, isActiveClient);
    });

    handleRebroadcasterClient(socket, {
      // console: this.console,
      connect: (connection) => {
        const now = Date.now();

        const safeWriteData = (chunk: StreamChunk, prebuffer?: boolean) => {
          if (options.filter) {
            chunk = options.filter(chunk, prebuffer);
            if (!chunk)
              return;
          }
          const buffered = connection.writeData(chunk);
          if (buffered > 100000000) {
            this.console.log('more than 100MB has been buffered, did downstream die? killing connection.', this.streamName);
            cleanup();
          }
        }

        const cleanup = () => {
          session.removeListener(container, safeWriteData);
          session.removeListener('killed', cleanup);
          connection.destroy();
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
        // If h264 oddities are detected, assume ffmpeg will be used.
        if (container !== 'rtsp' || !options.findSyncFrame || this.getLastH264Oddities()) {
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
            availablePrebuffers = [];
          }
          else {
            this.console.log('Found sync frame in rtsp prebuffer.');
          }
          for (const prebuffer of availablePrebuffers) {
            safeWriteData(prebuffer, true);
          }
        }

        return cleanup;
      }
    })
  }

  async getVideoStream(findSyncFrame: boolean, options?: RequestMediaStreamOptions) {
    if (options?.refresh === false && !this.parserSessionPromise)
      throw new Error('Stream is currently unavailable and will not be started for this request. RequestMediaStreamOptions.refresh === false');

    const startedParserSession = !this.parserSessionPromise;

    this.ensurePrebufferSession();

    const session = await this.parserSessionPromise;

    let requestedPrebuffer = options?.prebuffer;
    // if no prebuffer was requested, try to find a sync frame in the prebuffer.
    // also do this if this request initiated the prebuffer: so, an explicit request for 0 prebuffer
    // will still send the initial sync frame in the stream start. it may otherwise be missed
    // if some time passes between the initial stream request and the actual pulling of the stream.
    if (requestedPrebuffer == null || startedParserSession) {
      // prebuffer search for remote streaming should be even more conservative than local network.
      const defaultPrebuffer = options?.destination === 'remote' ? 2000 : 4000;
      // try to gaurantee a sync frame, but don't search too much prebuffer to make it happen.
      requestedPrebuffer = Math.min(defaultPrebuffer, this.getDetectedIdrInterval() || defaultPrebuffer);;
    }

    const mediaStreamOptions: ResponseMediaStreamOptions = session.negotiateMediaStream(options);
    let sdp = await this.sdp;
    if (!mediaStreamOptions.video?.h264Info && this.usingScryptedParser) {
      mediaStreamOptions.video ||= {};
      mediaStreamOptions.video.h264Info = this.getLastH264Probe();
    }

    let socketPromise: Promise<Duplex>;
    let url: string;
    let urls: string[];
    let filter: (chunk: StreamChunk, prebuffer: boolean) => StreamChunk;
    let interleavePassthrough = false;
    const interleavedMap = new Map<string, number>();
    const serverPortMap = new Map<string, RtspTrack>();
    let server: FileRtspServer;
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
      // if no prebuffer is explicitly requested, don't send prebuffer audio
      if (prebuffer && filterPrebufferAudio && chunk.type !== videoCodec)
        return;

      const channel = interleavedMap.get(chunk.type);
      if (!interleavePassthrough) {
        if (channel == undefined) {
          const udp = serverPortMap.get(chunk.type);
          if (udp)
            server.sendTrack(udp.control, chunk.chunks[1], chunk.type.startsWith('rtcp-'));
          return;
        }

        const chunks = chunk.chunks.slice();
        const header = Buffer.from(chunks[0]);
        header.writeUInt8(channel, 1);
        chunks[0] = header;
        chunk = {
          startStream: chunk.startStream,
          chunks,
        }
      }
      else if (channel === undefined) {
        return;
      }

      if (server.writeStream) {
        server.writeRtpPayload(chunk.chunks[0], chunk.chunks[1]);
        return;
      }

      return chunk;
    }

    const hostname = options?.route === 'internal' ? undefined : '0.0.0.0';

    const clientPromise = await listenSingleRtspClient({
      hostname,
      createServer: duplex => {
        sdp = addTrackControls(sdp);
        server = new FileRtspServer(duplex, sdp);
        server.writeConsole = this.console;
        return server;
      }
    });

    socketPromise = clientPromise.rtspServerPromise.then(async server => {
      if (session.parserSpecific) {
        const parserSpecific = session.parserSpecific as RtspSessionParserSpecific;
        server.resolveInterleaved = msection => {
          const channel = parserSpecific.interleaved.get(msection.codec);
          return [channel, channel + 1];
        }
      }
      // server.console = this.console;
      await server.handlePlayback();
      server.handleTeardown().catch(() => { }).finally(() => server.client.destroy());
      for (const track of Object.values(server.setupTracks)) {
        if (track.protocol === 'udp') {
          serverPortMap.set(track.codec, track);
          serverPortMap.set(`rtcp-${track.codec}`, track);
          continue;
        }
        interleavedMap.set(track.codec, track.destination);
        interleavedMap.set(`rtcp-${track.codec}`, track.destination + 1);
      }

      interleavePassthrough = session.parserSpecific && serverPortMap.size === 0;
      return server.client;
    })

    url = clientPromise.url;
    if (hostname) {
      urls = await getUrlLocalAdresses(this.console, url);
    }

    const container = 'rtsp';

    mediaStreamOptions.sdp = sdp;

    const isActiveClient = options?.refresh !== false;

    this.handleRebroadcasterClient({
      findSyncFrame,
      isActiveClient,
      container,
      requestedPrebuffer,
      socketPromise,
      session,
      filter,
    });

    mediaStreamOptions.prebuffer = requestedPrebuffer;

    if (this.audioDisabled) {
      mediaStreamOptions.audio = null;
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
    mediaStreamOptions.prebufferBytes = available;

    const length = Math.max(500000, available).toString();

    const inputArguments = [
      '-analyzeduration', '0', '-probesize', length,
    ];
    if (!this.usingScryptedUdpParser)
      inputArguments.push('-reorder_queue_size', '0');

    const ffmpegInput: FFmpegInput = {
      url,
      urls,
      container,
      inputArguments: [
        ...inputArguments,
        ...(this.parsers[container].inputArguments || []),
        '-f', this.parsers[container].container,
        '-i', url,
      ],
      mediaStreamOptions,
    }

    return ffmpegInput;
  }
}

class PrebufferMixin extends SettingsMixinDeviceBase<VideoCamera> implements VideoCamera, Settings {
  released = false;
  sessions = new Map<string, PrebufferSession>();
  streamSettings = createStreamSettings(this);
  rtspServer: net.Server;
  settingsListener: EventListenerRegister;

  constructor(public getTranscodeStorageSettings: () => Promise<any>, options: SettingsMixinDeviceOptions<VideoCamera & VideoCameraConfiguration>) {
    super(options);

    this.delayStart();

    (async () => {
      let retry = 1000;
      while (true) {
        try {
          await this.startRtspServer();
          break;
        }
        catch (e) {
          this.console.warn('Error starting RTSP Rebroadcast Server. Retrying shortly. If this problem persists, consider assigning a different port. This warning can be ignored if the rebroadcast URL is not in use.', e);
          await sleep(retry);
          retry = Math.min(60000, retry * 2);
        }
      }
    })();

    this.settingsListener = systemManager.listenDevice(this.id, ScryptedInterface.Settings, () => this.ensurePrebufferSessions());
  }

  async startRtspServer() {
    closeQuiet(this.rtspServer);

    this.rtspServer = new net.Server(async (client) => {
      this.console.log('external rtsp client', client.localAddress, client.localPort);

      let prebufferSession: PrebufferSession;

      const server = new RtspServer(client, undefined, false, async (method, url, headers, rawMessage) => {
        server.checkRequest = undefined;

        const u = new URL(url);

        for (const session of this.sessions.values()) {
          if (u.pathname === '/' + session.rtspServerPath) {
            server.console = session.console;
            prebufferSession = session;
            prebufferSession.ensurePrebufferSession();
            await prebufferSession.parserSessionPromise;
            server.sdp = await prebufferSession.sdp;
            return true;
          }
          if (u.pathname === '/' + session.rtspServerMutedPath) {
            server.console = session.console;
            prebufferSession = session;
            prebufferSession.ensurePrebufferSession();
            await prebufferSession.parserSessionPromise;
            const sdp = parseSdp(await prebufferSession.sdp);
            sdp.msections = sdp.msections.filter(msection => msection.type === 'video');
            server.sdp = sdp.toSdp();
            return true;
          }
        }

        return false;
      });

      this.console.log('RTSP Rebroadcast connection started.')
      server.console = this.console;

      try {
        await server.handlePlayback();
        const map = new Map<string, string>();
        for (const [id, track] of Object.entries(server.setupTracks)) {
          map.set(track.codec, id);
        }
        const session = await prebufferSession.parserSessionPromise;

        const requestedPrebuffer = Math.max(4000, prebufferSession.getDetectedIdrInterval() || 4000);;

        prebufferSession.handleRebroadcasterClient({
          findSyncFrame: true,
          isActiveClient: true,
          container: 'rtsp',
          session,
          socketPromise: Promise.resolve(client),
          requestedPrebuffer,
          filter: (chunk, prebuffer) => {
            const track = map.get(chunk.type);
            if (track)
              server.sendTrack(track, chunk.chunks[1], false);
            return undefined;
          }
        });

        await server.handleTeardown();
      }
      catch (e) {
        client.destroy();
      }
      this.console.log('RTSP Rebroadcast connection finished.')
    });

    this.rtspServer.listen(this.streamSettings.storageSettings.values.rebroadcastPort || 0);

    await once(this.rtspServer, 'listening').then(() => {
      const port = (this.rtspServer.address() as AddressInfo).port;
      this.streamSettings.storageSettings.values.rebroadcastPort = port;
    });
  }

  delayStart() {
    this.console.log('prebuffer sessions starting in 5 seconds');
    // to prevent noisy startup/reload/shutdown, delay the prebuffer starting.
    setTimeout(() => this.ensurePrebufferSessions(), 5000);
  }

  async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
    if (options?.route === 'direct')
      return this.mixinDevice.getVideoStream(options);

    await this.ensurePrebufferSessions();

    let id = options?.id;
    if (!this.sessions.has(id))
      id = undefined;
    let h264EncoderArguments: string[];
    let videoFilterArguments: string;
    let destinationVideoBitrate: number;

    const transcodingEnabled = this.mixins?.includes(getTranscodeMixinProviderId());

    const msos = await this.mixinDevice.getVideoStreamOptions();
    let result: {
      stream: ResponseMediaStreamOptions,
      isDefault: boolean,
      title: string;
    };

    const transcodeStorageSettings = await this.getTranscodeStorageSettings();
    const defaultLocalBitrate = 2000000;
    const defaultLowResolutionBitrate = 512000;
    if (!id) {
      switch (options?.destination) {
        case 'medium-resolution':
        case 'remote':
          result = this.streamSettings.getRemoteStream(msos);
          destinationVideoBitrate = transcodeStorageSettings.remoteStreamingBitrate;
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
        case 'local':
          result = this.streamSettings.getDefaultStream(msos);
          destinationVideoBitrate = defaultLocalBitrate;
          break;
        default:
          const width = options?.video?.width;
          const height = options?.video?.height;
          const max = Math.max(width, height);
          if (max) {
            if (max > 1280) {
              result = this.streamSettings.getDefaultStream(msos);
              destinationVideoBitrate = defaultLocalBitrate;
            }
            else if (max > 720) {
              result = this.streamSettings.getRemoteStream(msos);
              destinationVideoBitrate = transcodeStorageSettings.remoteStreamingBitrate;
            }
            else {
              result = this.streamSettings.getLowResolutionStream(msos);
              destinationVideoBitrate = defaultLowResolutionBitrate;
            }
          }
          else {
            result = this.streamSettings.getDefaultStream(msos);
            destinationVideoBitrate = defaultLocalBitrate;
          }
          break;
      }

      id = result.stream.id;
      this.console.log('Selected stream', result.stream.name);
      // transcoding video should never happen transparently since it is CPU intensive.
      // encourage users at every step to configure proper codecs.
      // for this reason, do not automatically supply h264 encoder arguments
      // even if h264 is requested, to force a visible failure.
      if (transcodingEnabled && this.streamSettings.storageSettings.values.transcodeStreams?.includes(result.title)) {
        h264EncoderArguments = transcodeStorageSettings.h264EncoderArguments?.split(' ');
        if (this.streamSettings.storageSettings.values.videoFilterArguments)
          videoFilterArguments = this.streamSettings.storageSettings.values.videoFilterArguments;
      }
    }

    let session = this.sessions.get(id);
    let ffmpegInput: FFmpegInput;
    if (!session.canPrebuffer) {
      this.console.log('Source container can not be prebuffered. Using a direct media stream.');
      session = undefined;
    }
    if (!session) {
      const mo = await this.mixinDevice.getVideoStream(options);
      if (!transcodingEnabled)
        return mo;
      ffmpegInput = await mediaManager.convertMediaObjectToJSON(mo, ScryptedMimeTypes.FFmpegInput);
    }
    else {
      // ffmpeg probing works better if the stream does NOT start on a sync frame. the pre-sps/pps data is used
      // as part of the stream analysis, and sync frame is immediately used. otherwise the sync frame is
      // read and tossed during rtsp analysis.
      // if ffmpeg is not in used (ie, not transcoding or implicitly rtsp),
      // trust that downstream is not using ffmpeg and start with a sync frame.
      const findSyncFrame = !transcodingEnabled
        && (!options?.container || options?.container === 'rtsp')
        && options?.tool !== 'ffmpeg';
      ffmpegInput = await session.getVideoStream(findSyncFrame, options);
    }

    ffmpegInput.h264EncoderArguments = h264EncoderArguments;
    ffmpegInput.destinationVideoBitrate = destinationVideoBitrate;

    if (transcodingEnabled && this.streamSettings.storageSettings.values.missingCodecParameters) {
      if (!ffmpegInput.mediaStreamOptions)
        ffmpegInput.mediaStreamOptions = { id };
      ffmpegInput.mediaStreamOptions.oobCodecParameters = true;
    }

    if (ffmpegInput.h264FilterArguments && videoFilterArguments)
      addVideoFilterArguments(ffmpegInput.h264FilterArguments, videoFilterArguments)
    else if (videoFilterArguments)
      ffmpegInput.h264FilterArguments = ['-filter_complex', videoFilterArguments];

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
        log.a(`${this.name} is a cloud camera. Prebuffering maintains a persistent stream and will not be enabled by default. You must enable the Prebuffer stream manually.`)
      }
    }

    if (!enabledIds.length)
      this.online = true;

    let active = 0;

    // figure out the default stream and streams that may have been removed due to
    // a config change.
    const toRemove = new Set(this.sessions.keys());
    toRemove.delete(undefined);
    this.sessions.delete(undefined);

    for (const id of ids) {
      toRemove.delete(id);

      let session = this.sessions.get(id);

      if (session)
        continue;

      const mso = msos?.find(mso => mso.id === id);
      if (mso?.prebuffer) {
        log.a(`Prebuffer is already available on ${this.name}. If this is a grouped device, disable the Rebroadcast extension.`)
      }
      const name = mso?.name;
      const enabled = enabledIds.includes(id);
      session = new PrebufferSession(this, mso, enabled, mso.allowBatteryPrebuffer);
      this.sessions.set(id, session);

      if (!enabled) {
        this.console.log('stream', name, 'is not enabled and will be rebroadcast on demand.');
        continue;
      }

      if (session.shouldDisableBatteryPrebuffer()) {
        this.console.log('camera is battery powered and either not charging or on low battery, prebuffering and rebroadcasting will only work on demand.');
      }

      (async () => {
        while (this.sessions.get(id) === session && !this.released) {
          if (session.shouldDisableBatteryPrebuffer()) {
            // since battery devices could be eligible for prebuffer, check periodically
            // in the event the battery device becomes eligible again
            await new Promise(resolve => setTimeout(resolve, 60000));
            continue;
          }

          session.ensurePrebufferSession();
          let wasActive = false;
          try {
            this.console.log(name, 'prebuffer session starting');
            const ps = await session.parserSessionPromise;
            active++;
            wasActive = true;
            this.online = !!active;
            await ps.killed;
          }
          catch (e) {
          }
          finally {
            if (wasActive)
              active--;
            wasActive = false;
            this.online = !!active;
          }
          this.console.log(this.name, 'restarting prebuffer session in 5 seconds');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        this.console.log(name, 'exiting prebuffer session (released or restarted with new configuration)');
      })();
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
        // this.console.log('Default Stream:', defaultSession.advertisedMediaStreamOptions.id, defaultSession.advertisedMediaStreamOptions.name);
      }
      else {
        this.console.warn('Unable to find Default Stream?');
      }
    }

    if (toRemove.size) {
      this.console.log('Removing sessions due to config change', [...toRemove]);
      for (const id of toRemove) {
        const session = this.sessions.get(id);
        this.sessions.delete(id);
        session.release();
      }
    }
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
      this.storage.setItem(key, value?.toString() || '');

    // no prebuffer change necessary if the setting is a transcoding hint.
    if (this.streamSettings.storageSettings.settings[key]?.group === 'Transcoding')
      return;

    const sessions = this.sessions;
    this.sessions = new Map();

    // kill and reinitiate the prebuffers.
    for (const session of sessions.values()) {
      session?.parserSessionPromise?.then(session => session.kill(new Error('rebroadcast settings changed')));
    }
    this.ensurePrebufferSessions();
  }

  getPrebufferedStreams(msos?: ResponseMediaStreamOptions[]) {
    return this.streamSettings.getPrebufferedStreams(msos);
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    const ret: ResponseMediaStreamOptions[] = await this.mixinDevice.getVideoStreamOptions() || [];
    let enabledStreams = this.getPrebufferedStreams(ret);

    const map = new Map<MediaStreamDestination, string>();
    map.set('local', this.streamSettings.getDefaultStream(ret)?.stream?.id);
    map.set('remote', this.streamSettings.getRemoteStream(ret)?.stream?.id);
    map.set('medium-resolution', this.streamSettings.getRemoteRecordingStream(ret)?.stream?.id);
    map.set('remote-recorder', this.streamSettings.getRemoteRecordingStream(ret)?.stream?.id);
    map.set('local-recorder', this.streamSettings.getRecordingStream(ret)?.stream?.id);
    map.set('low-resolution', this.streamSettings.getLowResolutionStream(ret)?.stream?.id);

    for (const mso of ret) {
      const session = this.sessions.get(mso.id);
      if (session?.parserSession || enabledStreams.includes(mso))
        mso.prebuffer = prebufferDurationMs;
      if (session && !mso.video?.h264Info) {
        mso.video ||= {};
        mso.video.h264Info = session.getLastH264Probe();
      }
      if (!mso.destinations) {
        mso.destinations = [];
        for (const [k, v] of map.entries()) {
          if (v === mso.id)
            mso.destinations.push(k);
        }
      }
    }

    return ret;
  }

  async release() {
    closeQuiet(this.rtspServer);
    this.settingsListener.removeListener();
    this.online = true;
    super.release();
    this.console.log('prebuffer sessions releasing if started');
    this.released = true;
    for (const session of this.sessions.values()) {
      session?.release();
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
  // no longer in use, but kept for future use.
  storageSettings = new StorageSettings(this, {});
  transcodeStorageSettings = new StorageSettings(this, {
    remoteStreamingBitrate: {
      title: 'Remote Streaming Bitrate',
      type: 'number',
      defaultValue: 1000000,
      description: 'The bitrate to use when remote streaming. This setting will only be used when transcoding or adaptive bitrate is enabled on a camera.',
      onPut() {
        sdk.deviceManager.onDeviceEvent('transcode', ScryptedInterface.Settings, undefined);
      },
    },
    h264EncoderArguments: {
      title: 'H264 Encoder Arguments',
      description: 'FFmpeg arguments used to encode h264 video. This is not camera specific and is used to setup the hardware accelerated encoder on your Scrypted server. This setting will only be used when transcoding is enabled on a camera.',
      choices: Object.keys(getH264EncoderArgs()),
      defaultValue: getDebugModeH264EncoderArgs().join(' '),
      combobox: true,
      mapPut: (oldValue, newValue) => getH264EncoderArgs()[newValue]?.join(' ') || newValue || getDebugModeH264EncoderArgs().join(' '),
      onPut() {
        sdk.deviceManager.onDeviceEvent('transcode', ScryptedInterface.Settings, undefined);
      },
    }
  });
  currentMixins = new Map<PrebufferMixin, {
    worker: Worker,
    id: string,
  }>();

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

    process.nextTick(() => {
      deviceManager.onDeviceDiscovered({
        nativeId: TRANSCODE_MIXIN_PROVIDER_NATIVE_ID,
        name: 'Transcoding',
        interfaces: [
          "SystemSettings",
          ScryptedInterface.Settings,
          ScryptedInterface.MixinProvider,
        ],
        type: ScryptedDeviceType.API,
      });
    });
  }

  async releaseDevice(id: string, nativeId: string): Promise<void> {
  }

  async getDevice(nativeId: string) {
    if (nativeId === TRANSCODE_MIXIN_PROVIDER_NATIVE_ID)
      return new TranscodeMixinProvider(this);
  }

  getSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }

  putSetting(key: string, value: SettingValue): Promise<void> {
    return this.storageSettings.putSetting(key, value);
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
      rtsp.console = this.console;
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

  async shouldEnableMixin(device: ScryptedDevice): Promise<boolean> {
    return device.type === ScryptedDeviceType.Camera || device.type === ScryptedDeviceType.Doorbell;
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (!interfaces.includes(ScryptedInterface.VideoCamera))
      return null;
    const ret = [ScryptedInterface.VideoCamera, ScryptedInterface.Settings, ScryptedInterface.Online, REBROADCAST_MIXIN_INTERFACE_TOKEN];
    return ret;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState) {
    this.setHasEnabledMixin(mixinDeviceState.id);

    // 8-11-2022
    // old scrypted had a bug where mixin device state was not exposing properties like id correctly
    // across rpc boundaries.
    let fork = false;
    try {
      const info = await systemManager.getComponent('info');
      const version = await info.getVersion();
      fork = semver.gte(version, '0.2.5');
    }
    catch (e) {
    }

    const { id } = mixinDeviceState;

    if (fork && sdk.fork && typeof mixinDeviceState.id === 'string') {
      const forked = sdk.fork<RebroadcastPluginFork>();
      const { worker } = forked;

      try {
        const result = await forked.result;
        const mixin = await result.newPrebufferMixin(async () => this.transcodeStorageSettings.values, mixinDevice, mixinDeviceInterfaces, mixinDeviceState);
        this.currentMixins.set(mixin, {
          worker,
          id,
        });
        return mixin;
      }
      catch (e) {
        throw e;
      }
    }
    else {
      const ret = await newPrebufferMixin(async () => this.transcodeStorageSettings.values, mixinDevice, mixinDeviceInterfaces, mixinDeviceState);
      this.currentMixins.set(ret, {
        worker: undefined,
        id,
      });
      return ret;
    }
  }

  async releaseMixin(id: string, mixinDevice: PrebufferMixin) {
    const worker = this.currentMixins.get(mixinDevice)?.worker;
    this.currentMixins.delete(mixinDevice);
    await mixinDevice.release().catch(() => { });
    await sleep(1000);
    worker?.terminate();
  }
}

async function newPrebufferMixin(getTranscodeStorageSettings: () => Promise<any>, mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState) {
  return new PrebufferMixin(getTranscodeStorageSettings, {
    mixinDevice,
    mixinDeviceState,
    mixinProviderNativeId: undefined,
    mixinDeviceInterfaces,
    group: "Streams",
    groupKey: "prebuffer",
  })
}

class RebroadcastPluginFork {
  newPrebufferMixin = newPrebufferMixin;
}

export async function fork() {
  return new RebroadcastPluginFork();
}

export default RebroadcastPlugin;
