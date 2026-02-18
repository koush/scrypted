import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { ListenZeroSingleClientTimeoutError, closeQuiet, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { readLength } from '@scrypted/common/src/read-stream';
import { H264_NAL_TYPE_IDR, H264_NAL_TYPE_SPS, RtspServer, RtspTrack, createRtspParser, findH264NaluType, listenSingleRtspClient } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, getSpsPps, parseSdp } from '@scrypted/common/src/sdp-utils';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import { sleep } from '@scrypted/common/src/sleep';
import { StreamChunk, StreamParser } from '@scrypted/common/src/stream-parser';
import sdk, { BufferConverter, ChargeState, EventListenerRegister, FFmpegInput, ForkWorker, MediaObject, MediaStreamDestination, MediaStreamOptions, MixinProvider, RequestMediaStreamOptions, ResponseMediaStreamOptions, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, SettingValue, Settings, VideoCamera, VideoCameraConfiguration, WritableDeviceState } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import crypto from 'crypto';
import { once } from 'events';
import { parse as h264SpsParse } from "h264-sps-parser";
import net, { AddressInfo } from 'net';
import path from 'path';
import { Duplex } from 'stream';
import { ParserOptions, ParserSession, startParserSession } from './ffmpeg-rebroadcast';
import { FileRtspServer } from './file-rtsp-server';
import { getUrlLocalAdresses } from './local-addresses';
import { REBROADCAST_MIXIN_INTERFACE_TOKEN } from './rebroadcast-mixin-token';
import { connectRFC4571Parser, startRFC4571Parser } from './rfc4571';
import { startRtmpSession } from './rtmp-session';
import { RtspSessionParserSpecific, startRtspSession } from './rtsp-session';
import { getSpsResolution } from './sps-resolution';
import { createStreamSettings } from './stream-settings';

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

type PrebufferParsers = 'rtsp';

class PrebufferSession {

  parserSessionPromise: Promise<ParserSession<PrebufferParsers>>;
  parserSession: ParserSession<PrebufferParsers>;
  rtspPrebuffer: PrebufferStreamChunk[] = []
  parsers: { [container: string]: StreamParser };
  sdp: Promise<string>;
  usingScryptedParser = false;
  usingScryptedUdpParser = false;

  mixinDevice: VideoCamera;
  console: Console;
  storage: Storage;

  activeClients = 0;
  inactivityTimeout: NodeJS.Timeout;
  syntheticInputIdKey: string;
  ffmpegInputArgumentsKey: string;
  ffmpegOutputArgumentsKey: string;
  lastDetectedAudioCodecKey: string;
  rtspParserKey: string;
  rtspServerPath: string;
  rtspServerMutedPath: string;

  batteryListener: EventListenerRegister;
  chargerListener: EventListenerRegister;

  constructor(public mixin: PrebufferMixin, public advertisedMediaStreamOptions: ResponseMediaStreamOptions, public enabled: boolean, public forceBatteryPrebuffer: boolean) {
    this.storage = mixin.storage;
    this.console = mixin.console;
    this.mixinDevice = mixin.mixinDevice;
    this.syntheticInputIdKey = 'syntheticInputIdKey-' + this.streamId;
    this.ffmpegInputArgumentsKey = 'ffmpegInputArguments-' + this.streamId;
    this.ffmpegOutputArgumentsKey = 'ffmpegOutputArguments-' + this.streamId;
    this.lastDetectedAudioCodecKey = 'lastDetectedAudioCodec-' + this.streamId;
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

  getDetectedIdrInterval() {
    const durations: number[] = [];
    if (this.rtspPrebuffer.length) {
      let last: number;

      for (const chunk of this.rtspPrebuffer) {
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
    this.rtspPrebuffer = [];
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
    let active = false;
    this.parserSessionPromise.then(pso => {
      pso.once('rtsp', () => {
        active = true;
        if (!this.mixin.online)
          this.mixin.online = true;
      });

      pso.killed.finally(() => {
        this.console.error(this.streamName, 'prebuffer session ended');
        this.parserSessionPromise = undefined;
      });
    })
      .catch(e => {
        this.console.error(this.streamName, 'prebuffer session ended with error', e);
        this.parserSessionPromise = undefined;

        if (!active) {
          // find sessions that arent this one, and check their prebuffers to see if any data has been received.
          // if there's no data, then consider this camera offline.
          const others = [...this.mixin.sessions.values()].filter(s => s !== this);
          if (others.length) {
            const hasData = others.some(s => s.rtspPrebuffer.length);
            if (!hasData && this.mixin.online)
              this.mixin.online = false;
          }
        }
      });
  }

  canUseRtspParser(mediaStreamOptions: MediaStreamOptions) {
    return mediaStreamOptions?.container?.startsWith('rtsp');
  }

  canUseRtmpParser(mediaStreamOptions: MediaStreamOptions) {
    return mediaStreamOptions?.container?.startsWith('rtmp');
  }

  getParser(mediaStreamOptions: MediaStreamOptions) {
    let parser: string;
    let rtspParser = this.storage.getItem(this.rtspParserKey);

    let isDefault = !rtspParser || rtspParser === 'Default';

    if (!this.canUseRtspParser(mediaStreamOptions) && !this.canUseRtmpParser(mediaStreamOptions)) {
      parser = STRING_DEFAULT;
      isDefault = true;
      rtspParser = undefined;
    }
    else {
      if (isDefault) {
        // use the plugin default
        rtspParser = localStorage.getItem('defaultRtspParser');
      }
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
      isDefault,
    }
  }

  async parseCodecs(skipResolution?: boolean) {
    const sdp = await this.parserSession.sdp;
    const parsedSdp = parseSdp(sdp);
    const videoSection = parsedSdp.msections.find(msection => msection.type === 'video');
    const audioSection = parsedSdp.msections.find(msection => msection.type === 'audio');

    const inputAudioCodec = audioSection?.codec;
    const inputVideoCodec = videoSection.codec;
    let inputVideoResolution: ReturnType<typeof getSpsResolution>;

    if (!skipResolution) {
      // scan the prebuffer for sps
      for (const chunk of this.rtspPrebuffer) {
        try {
          let sps = findH264NaluType(chunk, H264_NAL_TYPE_SPS);
          if (sps) {
            const parsedSps = h264SpsParse(sps);
            inputVideoResolution = getSpsResolution(parsedSps);
          }
          else if (!sps) {
            // sps = findH265NaluType(chunk, H265_NAL_TYPE_SPS);
          }
        }
        catch (e) {
        }
      }

      if (!inputVideoResolution) {
        try {
          const spspps = getSpsPps(videoSection);
          let { sps } = spspps;
          if (sps) {
            if (videoSection.codec === 'h264') {
              const parsedSps = h264SpsParse(sps);
              inputVideoResolution = getSpsResolution(parsedSps);
            }
            else if (videoSection.codec === 'h265') {
            }
          }
        }
        catch (e) {
        }
      }
    }

    return {
      inputVideoCodec,
      inputAudioCodec,
      inputVideoResolution,
    }
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings: Setting[] = [];

    const session = this.parserSession;

    let total = 0;
    let start = 0;
    for (const prebuffer of this.rtspPrebuffer) {
      start = start || prebuffer.time;
      for (const chunk of prebuffer.chunks) {
        total += chunk.byteLength;
      }
    }
    const elapsed = Date.now() - start;
    const bitrate = Math.round(total / elapsed * 8);

    const group = "Streams";
    const subgroup = `Stream: ${this.streamName}`;

    if (this.mixin.streamSettings.storageSettings.values.synthenticStreams.includes(this.streamId)) {
      const nonSynthetic = [...this.mixin.sessions.keys()].filter(s => s && !s.startsWith('synthetic:'));
      settings.push({
        group,
        subgroup,
        key: this.syntheticInputIdKey,
        title: 'Synthetic Stream Source',
        description: 'The source stream to transcode.',
        choices: nonSynthetic,
        value: this.storage.getItem(this.syntheticInputIdKey),
      });
    }

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
          title: 'FFmpeg Output Prefix',
          group,
          subgroup,
          description: 'Optional/Advanced: Additional output arguments to pass to the ffmpeg command. These will be placed before the output.',
          key: this.ffmpegOutputArgumentsKey,
          value: this.storage.getItem(this.ffmpegOutputArgumentsKey),
          choices: [
            '-c:v libx264 -pix_fmt yuvj420p -preset ultrafast -bf 0 -g 60 -r 15 -b:v 500000 -bufsize 1000000 -maxrate 500000'
          ],
          combobox: true,
        },
      )
    }

    let usingFFmpeg = true;

    if (this.canUseRtspParser(this.advertisedMediaStreamOptions) || this.canUseRtmpParser(this.advertisedMediaStreamOptions)) {
      const parser = this.getParser(this.advertisedMediaStreamOptions);
      const defaultValue = parser.parser;

      const currentParser = parser.isDefault ? STRING_DEFAULT : parser.parser;

      const choices = this.canUseRtmpParser(this.advertisedMediaStreamOptions)
        ? [
          STRING_DEFAULT,
          SCRYPTED_PARSER_TCP,
          FFMPEG_PARSER_TCP,
        ]
        : [
          STRING_DEFAULT,
          SCRYPTED_PARSER_TCP,
          SCRYPTED_PARSER_UDP,
          FFMPEG_PARSER_TCP,
          FFMPEG_PARSER_UDP,
        ]

      settings.push(
        {
          key: this.rtspParserKey,
          group,
          subgroup,
          title: 'RTSP Parser',
          description: `The RTSP Parser used to read the stream. The default is "${defaultValue}" for this stream.`,
          value: currentParser,
          choices,
        }
      );

      usingFFmpeg = !parser.parser.includes('Scrypted');
    }

    if (usingFFmpeg) {
      addFFmpegInputSettings();
    }

    if (session) {
      const codecInfo = await this.parseCodecs();
      const resolution = codecInfo.inputVideoResolution?.width && codecInfo.inputVideoResolution?.height
        ? `${codecInfo.inputVideoResolution?.width}x${codecInfo.inputVideoResolution?.height}`
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
          value: (codecInfo?.inputVideoCodec?.toString() || 'unknown') + '/' + (codecInfo?.inputAudioCodec?.toString() || 'unknown'),
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
      if (this.mixin.streamSettings.storageSettings.values.noAudio)
        mso.audio = null;
    }
    catch (e) {
    }

    if (this.mixin.streamSettings.storageSettings.values.privacyMode) {
      mso.audio = null;
    }

    // camera may explicity request that its audio stream be muted via a null.
    // respect that setting.
    const audioSoftMuted = mso?.audio === null;
    const advertisedAudioCodec = !audioSoftMuted && mso?.audio?.codec;

    let detectedAudioCodec = this.storage.getItem(this.lastDetectedAudioCodecKey) || undefined;
    if (detectedAudioCodec === 'null')
      detectedAudioCodec = null;

    const rbo: ParserOptions<PrebufferParsers> = {
      console: this.console,
      timeout: 60000,
      parsers: {
      },
    };
    this.parsers = rbo.parsers;

    let mo: MediaObject;
    if (this.mixin.streamSettings.storageSettings.values.privacyMode) {
      const ffmpegInput: FFmpegInput = {
        container: 'mp4',
        inputArguments: [
          '-re',
          '-stream_loop', '-1',
          '-i', 'camera-slash.mp4',
        ],
        mediaStreamOptions: {
          id: this.streamId,
          container: 'mp4',
        }
      };
      mo = await mediaManager.createMediaObject(ffmpegInput, ScryptedMimeTypes.FFmpegInput);
    }
    else if (this.mixin.streamSettings.storageSettings.values.synthenticStreams.includes(this.streamId)) {
      const syntheticInputId = this.storage.getItem(this.syntheticInputIdKey);
      if (!syntheticInputId)
        throw new Error('synthetic stream has not been configured with an input');
      const realDevice = systemManager.getDeviceById<VideoCamera>(this.mixin.id);
      mo = await realDevice.getVideoStream({
        id: syntheticInputId,
      });
    }
    else {
      mo = await this.mixinDevice.getVideoStream(mso);
    }
    const isRfc4571 = mo.mimeType === 'x-scrypted/x-rfc4571';

    let session: ParserSession<PrebufferParsers>;
    let sessionMso: ResponseMediaStreamOptions;

    // before launching the parser session, clear out the last detected codec.
    // an erroneous cached codec could cause ffmpeg to fail to start.
    this.storage.removeItem(this.lastDetectedAudioCodecKey);
    this.usingScryptedParser = false;

    if (isRfc4571) {
      this.usingScryptedParser = true;
      this.console.log('bypassing ffmpeg: using scrypted rfc4571 parser')
      const json = await mediaManager.convertMediaObjectToJSON<any>(mo, 'x-scrypted/x-rfc4571');
      let { url, sdp, mediaStreamOptions } = json;
      sdp = addTrackControls(sdp);
      sessionMso = mediaStreamOptions;

      const rtspParser = createRtspParser();
      rbo.parsers.rtsp = rtspParser;

      session = startRFC4571Parser(this.console, connectRFC4571Parser(url), sdp, mediaStreamOptions, {
        timeout: 10000,
      });
    }
    else {
      const ffmpegInput: FFmpegInput = await mediaManager.convertMediaObjectToJSON(mo, ScryptedMimeTypes.FFmpegInput);
      sessionMso = ffmpegInput.mediaStreamOptions || this.advertisedMediaStreamOptions;

      let { parser, isDefault } = this.getParser(sessionMso);
      this.usingScryptedParser = parser === SCRYPTED_PARSER_TCP || parser === SCRYPTED_PARSER_UDP;
      this.usingScryptedUdpParser = parser === SCRYPTED_PARSER_UDP;

      if (this.usingScryptedParser) {
        if (this.canUseRtmpParser(sessionMso)) {
          // rtmp becomes repackaged as rtsp
          const rtspParser = createRtspParser();
          rbo.parsers.rtsp = rtspParser;

          session = await startRtmpSession(this.console, ffmpegInput.url, ffmpegInput.mediaStreamOptions, {
            audioSoftMuted,
            rtspRequestTimeout: 10000,
          });
        }
        else {
          const rtspParser = createRtspParser();
          rbo.parsers.rtsp = rtspParser;

          session = await startRtspSession(this.console, ffmpegInput.url, ffmpegInput.mediaStreamOptions, {
            useUdp: parser === SCRYPTED_PARSER_UDP,
            audioSoftMuted,
            rtspRequestTimeout: 10000,
          });
        }
      }
      else {
        let acodec: string[];

        if (audioSoftMuted) {
          // no audio? explicitly disable it.
          acodec = ['-an'];
        }
        else {
          acodec = [
            '-acodec',
            'copy',
          ];
        }

        let vcodec = [
          '-vcodec', 'copy',
        ];

        acodec = audioSoftMuted ? acodec : ['-acodec', 'copy'];

        if (!this.canUseRtmpParser(mso)) {
          if (parser === FFMPEG_PARSER_UDP)
            ffmpegInput.inputArguments = ['-rtsp_transport', 'udp', '-i', ffmpegInput.url];
          else if (parser === FFMPEG_PARSER_TCP)
            ffmpegInput.inputArguments = ['-rtsp_transport', 'tcp', '-i', ffmpegInput.url];
        }
        // create missing pts from dts so mpegts and mp4 muxing does not fail
        const userInputArguments = this.storage.getItem(this.ffmpegInputArgumentsKey);
        const extraInputArguments = userInputArguments || DEFAULT_FFMPEG_INPUT_ARGUMENTS;
        const extraOutputArguments = this.storage.getItem(this.ffmpegOutputArgumentsKey) || '';
        ffmpegInput.inputArguments.unshift(...extraInputArguments.split(' '));

        if (ffmpegInput.h264EncoderArguments?.length) {
          vcodec = [...ffmpegInput.h264EncoderArguments];
        }
        // extraOutputArguments must contain full codec information
        if (extraOutputArguments) {
          vcodec = [...extraOutputArguments.split(' ').filter(d => !!d)];
          acodec = [];
        }

        const rtspParser = createRtspParser({
          vcodec,
          // the rtsp parser should always stream copy unless audio is soft muted.
          acodec,
        });
        rbo.parsers.rtsp = rtspParser;

        session = await startParserSession(ffmpegInput, rbo);
      }
    }

    this.sdp = session.sdp;
    session.on('error', e => {
      if (!e.message?.startsWith('killed:'))
        console.error('rebroadcast error', e)
    });

    await session.sdp;
    this.parserSession = session;
    session.killed.finally(() => {
      if (this.parserSession === session)
        this.parserSession = undefined;
    });
    session.killed.finally(() => clearTimeout(this.inactivityTimeout));

    const codecInfo = await this.parseCodecs();

    // complain to the user about the codec if necessary. upstream may send a audio
    // stream but report none exists (to request muting).
    if (!audioSoftMuted && advertisedAudioCodec && codecInfo.inputAudioCodec !== undefined
      && codecInfo.inputAudioCodec !== advertisedAudioCodec) {
      this.console.warn('Audio codec plugin reported vs detected mismatch', advertisedAudioCodec, detectedAudioCodec);
    }

    const advertisedVideoCodec = mso?.video?.codec;
    if (advertisedVideoCodec && codecInfo.inputVideoCodec !== undefined
      && codecInfo.inputVideoCodec !== advertisedVideoCodec) {
      this.console.warn('Video codec plugin reported vs detected mismatch', advertisedVideoCodec, codecInfo.inputVideoCodec);
    }

    if (!codecInfo.inputAudioCodec) {
      this.console.log('No audio stream detected.');
    }

    // set/update the detected codec, set it to null if no audio was found.
    this.storage.setItem(this.lastDetectedAudioCodecKey, codecInfo.inputAudioCodec || 'null');

    if (codecInfo.inputVideoCodec !== 'h264') {
      this.console.error(`Video codec is not h264. If there are errors, try changing your camera's encoder output.`);
    }

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
        const ffmpegInput: FFmpegInput = await mediaManager.convertMediaObjectToJSON(mo, ScryptedMimeTypes.FFmpegInput);
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

    let shifts = 0;
    let prebufferContainer: PrebufferStreamChunk[] = this.rtspPrebuffer;

    session.on('rtsp', (chunk: PrebufferStreamChunk) => {
      const now = Date.now();

      chunk.time = now;
      prebufferContainer.push(chunk);

      while (prebufferContainer.length && prebufferContainer[0].time < now - prebufferDurationMs) {
        prebufferContainer.shift();
        shifts++;
      }

      if (shifts > 100000) {
        prebufferContainer = prebufferContainer.slice();
        this.rtspPrebuffer = prebufferContainer;
        shifts = 0;
      }
    });

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
      session.kill(new Error('killed: stream inactivity'));
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
          session.kill(new Error('killed: low battery or not charging'));
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
    session: ParserSession<PrebufferParsers>,
    socketPromise: Promise<Duplex>,
    requestedPrebuffer: number,
    filter?: (chunk: StreamChunk, prebuffer: boolean) => StreamChunk,
  }) {
    const { isActiveClient, session, socketPromise, requestedPrebuffer } = options;
    // this.console.log('sending prebuffer', requestedPrebuffer);

    let socket: Duplex;

    try {
      socket = await socketPromise;

      if (!session.isActive) {
        // session may be killed while waiting for socket.
        socket.destroy();
        throw new Error('session terminated before socket connected');
      }
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

    let writeData = (data: StreamChunk): number => {
      if (data.startStream) {
        socket.write(data.startStream)
      }

      const writeDataWithoutStartStream = (data: StreamChunk) => {
        for (const chunk of data.chunks) {
          socket.write(chunk);
        }

        return socket.writableLength;
      };

      writeData = writeDataWithoutStartStream;
      return writeDataWithoutStartStream(data);
    }

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
      socket.destroy();
      session.removeListener('rtsp', safeWriteData);
      session.removeListener('killed', cleanup);
    };

    session.on('rtsp', safeWriteData);
    session.once('killed', cleanup);

    socket.once('close', () => {
      cleanup();
    });

    // socket.on('error', e => this.console.log('client stream ended'));


    const now = Date.now();
    const prebufferContainer: PrebufferStreamChunk[] = this.rtspPrebuffer;
    // if starting on a sync frame, ffmpeg will skip the first segment while initializing
    // on live sources like rtsp. the buffer before the sync frame stream will be enough
    // for ffmpeg to analyze and start up in time for the sync frame.
    if (!options.findSyncFrame) {
      for (const chunk of prebufferContainer) {
        if (chunk.time < now - requestedPrebuffer)
          continue;

        safeWriteData(chunk, true);
      }
    }
    else {
      const parser = this.parsers['rtsp'];
      const filtered = prebufferContainer.filter(pb => pb.time >= now - requestedPrebuffer);
      let availablePrebuffers = parser.findSyncFrame(filtered);
      if (!availablePrebuffers) {
        this.console.warn('Unable to find sync frame in rtsp prebuffer.');
        availablePrebuffers = [];
      }
      else {
        // this.console.log('Found sync frame in rtsp prebuffer.');
      }
      for (const prebuffer of availablePrebuffers) {
        safeWriteData(prebuffer, true);
      }
    }
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
      requestedPrebuffer = Math.min(defaultPrebuffer, this.getDetectedIdrInterval() || defaultPrebuffer);
    }

    const codecInfo = await this.parseCodecs(true);
    const mediaStreamOptions: ResponseMediaStreamOptions = session.negotiateMediaStream(options, codecInfo.inputVideoCodec, codecInfo.inputAudioCodec);
    let sdp = await this.sdp;

    if (this.mixin.streamSettings.storageSettings.values.noAudio)
      mediaStreamOptions.audio = null;

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
    // ensure the mso and sdp both reflect audio mute, or no audio found (which can be an upstream plugin error)
    if (mediaStreamOptions.audio === null)
      audioSection = undefined;
    if (!audioSection)
      mediaStreamOptions.audio = null;
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
          type: chunk.type,
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
      pathToken: path.join(crypto.randomBytes(8).toString('hex'), this.mixin.id),
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

    mediaStreamOptions.sdp = sdp;

    const isActiveClient = options?.refresh !== false;

    this.handleRebroadcasterClient({
      findSyncFrame,
      isActiveClient,
      requestedPrebuffer,
      socketPromise,
      session,
      filter,
    });
    mediaStreamOptions.prebuffer = 0;

    if (audioSection) {
      mediaStreamOptions.audio ||= {};
      mediaStreamOptions.audio.codec ||= audioSection.rtpmap.codec;
      mediaStreamOptions.audio.sampleRate ||= audioSection.rtpmap.clock;
    }

    if (codecInfo.inputVideoResolution?.width && codecInfo.inputVideoResolution?.height) {
      // this may be an audio only request.
      if (mediaStreamOptions.video)
        Object.assign(mediaStreamOptions.video, codecInfo.inputVideoResolution);
    }

    const now = Date.now();
    let available = 0;
    const prebufferContainer: PrebufferStreamChunk[] = this.rtspPrebuffer;
    for (const prebuffer of prebufferContainer) {
      if (prebuffer.time < now - requestedPrebuffer)
        continue;
      if (!mediaStreamOptions.prebuffer)
        mediaStreamOptions.prebuffer = now - prebuffer.time;
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
      container: 'rtsp',
      inputArguments: [
        ...inputArguments,
        ...(this.parsers['rtsp'].inputArguments || []),
        '-f', this.parsers['rtsp'].container,
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
  videoCameraListener: EventListenerRegister;

  constructor(options: SettingsMixinDeviceOptions<VideoCamera & VideoCameraConfiguration>) {
    super(options);

    const rebroadcast = systemManager.getDeviceById('@scrypted/prebuffer-mixin').id;
    const expected: string[] = [rebroadcast];

    const webrtc = systemManager.getDeviceById('@scrypted/webrtc');
    if (webrtc && this.providedInterfaces.includes(ScryptedInterface.RTCSignalingChannel))
      expected.unshift(webrtc.id);

    let matched = true;
    for (let i = 0; i < expected.length; i++) {
      if (this.mixins[i] !== expected[i]) {
        matched = false;
        break;
      }
    }

    if (!matched) {
      this.console.warn('rebroadcast/webrtc order not matched. this may cause flapping on interface changes. fixing.');
      setTimeout(() => {
        const currentMixins = this.mixins.filter(mixin => !expected.includes(mixin));
        currentMixins.unshift(...expected);
        const realDevice = systemManager.getDeviceById(this.id);
        realDevice.setMixins(currentMixins);
      }, 1000);
    }

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
    this.videoCameraListener = systemManager.listenDevice(this.id, ScryptedInterface.VideoCamera, () => this.reinitiatePrebufferSessions());
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
          session,
          socketPromise: Promise.resolve(client),
          requestedPrebuffer,
          filter: (chunk, prebuffer) => {
            const track = map.get(chunk.type);
            if (track) {
              server.sendTrack(track, chunk.chunks[1], false);
              const buffered = server.client.writableLength;
              if (buffered > 100000000) {
                this.console.log('more than 100MB has been buffered to RTSP Client, did downstream die? killing connection.');
                client.destroy();
              }
            }
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
    await this.ensurePrebufferSessions();

    let id = options?.id;
    if (!this.sessions.has(id))
      id = undefined;

    const msos = await this.mixinDevice.getVideoStreamOptions();
    let result: {
      stream: ResponseMediaStreamOptions,
      isDefault: boolean,
      title: string;
    };

    if (!id) {
      switch (options?.destination) {
        case 'medium-resolution':
        case 'remote':
          result = this.streamSettings.getRemoteStream(msos);
          break;
        case 'low-resolution':
          result = this.streamSettings.getLowResolutionStream(msos);
          break;
        case 'local-recorder':
          result = this.streamSettings.getRecordingStream(msos);
          break;
        case 'remote-recorder':
          result = this.streamSettings.getRemoteRecordingStream(msos);
          break;
        case 'local':
          result = this.streamSettings.getDefaultStream(msos);
          break;
        default:
          const width = options?.video?.width;
          const height = options?.video?.height;
          const max = Math.max(width, height);
          if (max) {
            if (max > 1280) {
              result = this.streamSettings.getDefaultStream(msos);
            }
            else if (max > 720) {
              result = this.streamSettings.getRemoteStream(msos);
            }
            else {
              result = this.streamSettings.getLowResolutionStream(msos);
            }
          }
          else {
            result = this.streamSettings.getDefaultStream(msos);
          }
          break;
      }

      id = result.stream.id;
    }

    let session = this.sessions.get(id);
    let ffmpegInput: FFmpegInput;
    if (!session)
      throw new Error('stream not found');

    ffmpegInput = await session.getVideoStream(true, options);

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
    if (this.storage.getItem('warnedSynthetic') !== 'true') {
      const synthetic = msos?.find(mso => mso.source === 'synthetic');
      if (synthetic) {
        this.storage.setItem('warnedSynthetic', 'true');
        log.a(`${this.name} is a synthetic stream requiring substantial transcoding overhead. Prebuffering maintains a persistent stream and will not be enabled by default. You must enable the Prebuffer stream manually.`)
      }
    }

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
      session = new PrebufferSession(this, mso, enabled, mso?.allowBatteryPrebuffer ?? false);
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
          try {
            this.console.log(name, 'prebuffer session starting');
            const ps = await session.parserSessionPromise;
            await ps.killed;
          }
          catch (e) {
          }
          this.console.log(this.name, 'restarting prebuffer session in 5 seconds');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        this.console.log(name, 'exiting prebuffer session (released or restarted with new configuration)');
      })();
    }

    for (const synthetic of this.streamSettings.storageSettings.values.synthenticStreams) {
      const id = `synthetic:${synthetic}`;
      toRemove.delete(id);

      let session = this.sessions.get(id);

      if (session)
        continue;

      session = new PrebufferSession(this, {
        id: synthetic,
      }, false, false);
      this.sessions.set(id, session);
      this.console.log('stream', synthetic, 'is synthetic and will be rebroadcast on demand.');
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

  async reinitiatePrebufferSessions() {
    const sessions = this.sessions;
    this.sessions = new Map();
    // kill and reinitiate the prebuffers.
    for (const session of sessions.values()) {
      session?.parserSessionPromise?.then(session => session.kill(new Error('rebroadcast settings changed')));
    }
    this.ensurePrebufferSessions();
  }

  async putMixinSetting(key: string, value: SettingValue): Promise<void> {
    if (this.streamSettings.storageSettings.settings[key])
      await this.streamSettings.storageSettings.putSetting(key, value);
    else
      this.storage.setItem(key, value?.toString() || '');

    // no prebuffer change necessary if the setting is a transcoding hint.
    if (this.streamSettings.storageSettings.settings[key]?.group === 'Transcoding')
      return;

    this.reinitiatePrebufferSessions();
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
    this.videoCameraListener.removeListener();
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

export class RebroadcastPlugin extends AutoenableMixinProvider implements MixinProvider, BufferConverter, Settings, Settings {
  // no longer in use, but kept for future use.
  storageSettings = new StorageSettings(this, {
    defaultRtspParser: {
      group: 'Advanced',
      title: 'Default RTSP Parser',
      description: `Experimental: The Default parser used to read RTSP streams. The default is "${SCRYPTED_PARSER_TCP}".`,
      defaultValue: STRING_DEFAULT,
      choices: [
        STRING_DEFAULT,
        SCRYPTED_PARSER_TCP,
        SCRYPTED_PARSER_UDP,
        FFMPEG_PARSER_TCP,
        FFMPEG_PARSER_UDP,
      ],
      onPut: () => {
        this.log.a('Rebroadcast Plugin will restart momentarily.');
        sdk.deviceManager.requestRestart();
      }
    }
  });

  currentMixins = new Map<PrebufferMixin, {
    worker: ForkWorker,
    id: string,
  }>();

  constructor(nativeId?: string) {
    super(nativeId);

    this.log.clearAlerts();

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

    // legacy transcode extension that needs to be removed.
    if (sdk.deviceManager.getNativeIds().includes('transcode')) {
      process.nextTick(() => {
        deviceManager.onDeviceRemoved('transcode');
      });
    }
  }

  async getSettings(): Promise<Setting[]> {
    return [
      ...await this.storageSettings.getSettings(),
    ];
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
    const { clientPromise, url: clientUrl } = await listenZeroSingleClient('127.0.0.1');
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

  shouldUnshiftMixin(device: ScryptedDevice): boolean {
    return device.providedInterfaces.includes(ScryptedInterface.VideoCamera);
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (type !== ScryptedDeviceType.Doorbell && type !== ScryptedDeviceType.Camera)
      return;
    if (!interfaces.includes(ScryptedInterface.VideoCamera))
      return;
    const ret = [ScryptedInterface.VideoCamera, ScryptedInterface.Settings, ScryptedInterface.Online, REBROADCAST_MIXIN_INTERFACE_TOKEN];
    return ret;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState) {
    this.setHasEnabledMixin(mixinDeviceState.id);

    const { id } = mixinDeviceState;
    const forked = sdk.fork<RebroadcastPluginFork>();
    const { worker } = forked;
    const result = await forked.result;
    const mixin = await result.newPrebufferMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState);
    this.currentMixins.set(mixin, {
      worker,
      id,
    });
    return mixin;
  }

  async releaseMixin(id: string, mixinDevice: PrebufferMixin) {
    const worker = this.currentMixins.get(mixinDevice)?.worker;
    this.currentMixins.delete(mixinDevice);
    await mixinDevice.release().catch(() => { });
    await sleep(1000);
    worker?.terminate();
  }
}

async function newPrebufferMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState) {
  return new PrebufferMixin({
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
