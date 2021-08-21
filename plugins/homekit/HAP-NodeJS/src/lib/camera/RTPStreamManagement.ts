import crypto from 'crypto';
import createDebug from 'debug';
import net from "net";
// noinspection JSDeprecatedSymbols
import { LegacyCameraSource, LegacyCameraSourceAdapter, once, uuid } from "../../index";
import { CharacteristicValue, Nullable, SessionIdentifier } from '../../types';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback } from '../Characteristic';
import { CameraController, CameraStreamingDelegate } from "../controller";
import type { CameraRTPStreamManagement } from "../definitions";
import { HAPStatus } from "../HAPServer";
import { Service } from '../Service';
import { HAPConnection, HAPConnectionEvent } from "../util/eventedhttp";
import * as tlv from '../util/tlv';
import RTPProxy from './RTPProxy';

const debug = createDebug('HAP-NodeJS:Camera:RTPStreamManagement');
// ---------------------------------- TLV DEFINITIONS START ----------------------------------

const enum StreamingStatusTypes {
  STATUS = 0x01,
}

const enum StreamingStatus {
  AVAILABLE = 0x00,
  IN_USE = 0x01, // Session is marked IN_USE after the first setup request
  UNAVAILABLE = 0x02, // other reasons
}

// ----------

const enum SupportedVideoStreamConfigurationTypes {
  VIDEO_CODEC_CONFIGURATION = 0x01,
}

const enum VideoCodecConfigurationTypes {
  CODEC_TYPE = 0x01,
  CODEC_PARAMETERS = 0x02,
  ATTRIBUTES = 0x03,
}

const enum VideoCodecParametersTypes {
  PROFILE_ID = 0x01,
  LEVEL = 0x02,
  PACKETIZATION_MODE = 0x03,
  CVO_ENABLED = 0x04,
  CVO_ID = 0x05, // ID for CVO RTP extension, value in range from 1 to 14
}

const enum VideoAttributesTypes {
  IMAGE_WIDTH = 0x01,
  IMAGE_HEIGHT = 0x02,
  FRAME_RATE = 0x03
}

const enum VideoCodecType {
  H264 = 0x00
}

export const enum H264Profile {
  BASELINE = 0x00,
  MAIN = 0x01,
  HIGH = 0x02,
}

export const enum H264Level {
  LEVEL3_1 = 0x00,
  LEVEL3_2 = 0x01,
  LEVEL4_0 = 0x02,
}

const enum VideoCodecPacketizationMode {
  NON_INTERLEAVED = 0x00
}

const enum VideoCodecCVO { // Coordination of Video Orientation
  UNSUPPORTED = 0x01,
  SUPPORTED = 0x02
}

// ----------

const enum SupportedAudioStreamConfigurationTypes {
  AUDIO_CODEC_CONFIGURATION = 0x01,
  COMFORT_NOISE_SUPPORT = 0x02,
}

const enum AudioCodecConfigurationTypes {
  CODEC_TYPE = 0x01,
  CODEC_PARAMETERS = 0x02,
}

const enum AudioCodecTypes { // only really by HAP supported codecs are AAC-ELD and OPUS
  PCMU = 0x00,
  PCMA = 0x01,
  AAC_ELD = 0x02,
  OPUS = 0x03,
  MSBC = 0x04, // mSBC is a bluetooth codec (lol)
  AMR = 0x05,
  AMR_WB = 0x06,
}

const enum AudioCodecParametersTypes {
  CHANNEL = 0x01,
  BIT_RATE = 0x02,
  SAMPLE_RATE = 0x03,
  PACKET_TIME = 0x04 // only present in selected audio codec parameters tlv
}

const enum AudioBitrate {
  VARIABLE = 0x00,
  CONSTANT = 0x01
}

const enum AudioSamplerate {
  KHZ_8 = 0x00,
  KHZ_16 = 0x01,
  KHZ_24 = 0x02
  // 3, 4, 5 are theoretically defined, but no idea to what kHz value they correspond to
  // probably KHZ_32, KHZ_44_1, KHZ_48 (as supported by Secure Video recordings)
}

// ----------

const enum SupportedRTPConfigurationTypes {
  SRTP_CRYPTO_SUITE = 0x02,
}

export const enum SRTPCryptoSuites { // public API
  AES_CM_128_HMAC_SHA1_80 = 0x00,
  AES_CM_256_HMAC_SHA1_80 = 0x01,
  NONE = 0x02
}


// ----------


const enum SetupEndpointsTypes {
  SESSION_ID = 0x01,
  CONTROLLER_ADDRESS = 0x03,
  VIDEO_SRTP_PARAMETERS = 0x04,
  AUDIO_SRTP_PARAMETERS = 0x05,
}

const enum AddressTypes {
  ADDRESS_VERSION = 0x01,
  ADDRESS = 0x02,
  VIDEO_RTP_PORT = 0x03,
  AUDIO_RTP_PORT = 0x04,
}

const enum IPAddressVersion {
  IPV4 = 0x00,
  IPV6 = 0x01
}


const enum SRTPParametersTypes {
  SRTP_CRYPTO_SUITE = 0x01,
  MASTER_KEY = 0x02, // 16 bytes for AES_CM_128_HMAC_SHA1_80; 32 bytes for AES_256_CM_HMAC_SHA1_80
  MASTER_SALT = 0x03 // 14 bytes
}

const enum SetupEndpointsResponseTypes {
  SESSION_ID = 0x01,
  STATUS = 0x02,
  ACCESSORY_ADDRESS = 0x03,
  VIDEO_SRTP_PARAMETERS = 0x04,
  AUDIO_SRTP_PARAMETERS = 0x05,
  VIDEO_SSRC = 0x06,
  AUDIO_SSRC = 0x07,
}

const enum SetupEndpointsStatus {
  SUCCESS = 0x00,
  BUSY = 0x01,
  ERROR = 0x02
}


// ----------


const enum SelectedRTPStreamConfigurationTypes {
  SESSION_CONTROL = 0x01,
  SELECTED_VIDEO_PARAMETERS = 0x02,
  SELECTED_AUDIO_PARAMETERS = 0x03
}

const enum SessionControlTypes {
  SESSION_IDENTIFIER = 0x01, // uuid, 16 bytes
  COMMAND = 0x02,
}

enum SessionControlCommand {
  END_SESSION = 0x00,
  START_SESSION = 0x01,
  SUSPEND_SESSION = 0x02,
  RESUME_SESSION = 0x03,
  RECONFIGURE_SESSION = 0x04,
}

const enum SelectedVideoParametersTypes {
  CODEC_TYPE = 0x01,
  CODEC_PARAMETERS = 0x02,
  ATTRIBUTES = 0x03,
  RTP_PARAMETERS = 0x04,
}

const enum VideoRTPParametersTypes {
  PAYLOAD_TYPE = 0x01,
  SYNCHRONIZATION_SOURCE = 0x02,
  MAX_BIT_RATE = 0x03,
  MIN_RTCP_INTERVAL = 0x04, // minimum RTCP interval in seconds
  MAX_MTU = 0x05, // only there if value is not default value; default values: ipv4 1378; ipv6 1228 bytes
}

const enum SelectedAudioParametersTypes {
  CODEC_TYPE = 0x01,
  CODEC_PARAMETERS = 0x02,
  RTP_PARAMETERS = 0x03,
  COMFORT_NOISE = 0x04,
}

const enum AudioRTPParametersTypes {
  PAYLOAD_TYPE = 0x01,
  SYNCHRONIZATION_SOURCE = 0x02,
  MAX_BIT_RATE = 0x03,
  MIN_RTCP_INTERVAL = 0x04, // minimum RTCP interval in seconds
  COMFORT_NOISE_PAYLOAD_TYPE = 0x06
}

// ---------------------------------- TLV DEFINITIONS END ------------------------------------

/**
 * @deprecated renamed to {@see CameraStreamingOptions}
 */
export type StreamControllerOptions = CameraStreamingOptions;
export type CameraStreamingOptions = CameraStreamingOptionsBase & (CameraStreamingOptionsLegacySRTP | CameraStreamingOptionsSupportedCryptoSuites)
interface CameraStreamingOptionsBase {
  proxy?: boolean; // default false
  disable_audio_proxy?: boolean; // default false; If proxy = true, you can opt out audio proxy via this

  video: VideoStreamingOptions;
  /**
   * "audio" is optional and only needs to be declared if audio streaming is supported.
   * If defined the Microphone service will be added and Microphone volume control will be made available.
   * If not defined hap-nodejs will expose a default codec in order for the video stream to work
   */
  audio?: AudioStreamingOptions;
}

interface CameraStreamingOptionsLegacySRTP {
  srtp: boolean; // a value of true indicates support of AES_CM_128_HMAC_SHA1_80
}
interface CameraStreamingOptionsSupportedCryptoSuites {
  supportedCryptoSuites: SRTPCryptoSuites[], // Suite NONE should only be used for testing and will probably be never selected by iOS!
}

function isLegacySRTPOptions(options: any): options is CameraStreamingOptionsLegacySRTP {
  return "srtp" in options;
}

export type VideoStreamingOptions = {
  codec: H264CodecParameters,
  resolutions: Resolution[],
  cvoId?: number,
}

export type H264CodecParameters = {
  levels: H264Level[],
  profiles: H264Profile[],
}

export type Resolution = [number, number, number]; // width, height, framerate

export type AudioStreamingOptions = {
  codecs: AudioStreamingCodec[],
  twoWayAudio?: boolean, // default false, indicates support of 2way audio (will add the Speaker service and Speaker volume control)
  comfort_noise?: boolean, // default false
}

export type AudioStreamingCodec = {
  type: AudioStreamingCodecType | string, // string type for backwards compatibility
  audioChannels?: number, // default 1
  bitrate?: AudioBitrate, // default VARIABLE, AAC-ELD or OPUS MUST support VARIABLE bitrate
  samplerate: AudioStreamingSamplerate[] | AudioStreamingSamplerate, // OPUS or AAC-ELD must support samplerate at 16k and 25k
}

export const enum AudioStreamingCodecType { // codecs as defined by the HAP spec; only AAC-ELD and OPUS seem to work
  PCMU = "PCMU",
  PCMA = "PCMA",
  AAC_ELD = "AAC-eld",
  OPUS = "OPUS",
  MSBC = "mSBC",
  AMR = "AMR",
  AMR_WB = "AMR-WB",
}

export const enum AudioStreamingSamplerate {
  KHZ_8 = 8,
  KHZ_16 = 16,
  KHZ_24 = 24,
}


export type StreamSessionIdentifier = string; // uuid provided by HAP to identify a streaming session

export type SnapshotRequest = {
  height: number;
  width: number;
}

export type PrepareStreamRequest = {
  sessionID: StreamSessionIdentifier,
  targetAddress: string,
  addressVersion: "ipv4" | "ipv6",
  audio: Source,
  video: Source,
}

export type Source = {
  port: number,

  srtpCryptoSuite: SRTPCryptoSuites, // if cryptoSuite is NONE, key and salt are both zero-length
  srtp_key: Buffer,
  srtp_salt: Buffer,

  proxy_rtp?: number,
  proxy_rtcp?: number,
};

export type PrepareStreamResponse = {
  /**
   * @deprecated The local ip address will be automatically determined by HAP-NodeJS.
   *   Any value set will be ignored. You may only still set a value to support version prior to 0.7.9
   */
  address?: string | Address;
  /**
   * Any value set to this optional property will overwrite the automatically determined local address,
   * which is sent as RTP endpoint to the iOS device.
   */
  addressOverride?: string;
  // video should be instanceOf ProxiedSourceResponse if proxy is required
  video: SourceResponse | ProxiedSourceResponse;
  // needs to be only supplied if audio is required; audio should be instanceOf ProxiedSourceResponse if proxy is required and audio proxy is not disabled
  audio?: SourceResponse | ProxiedSourceResponse;
}

/**
 * @deprecated just supply the address directly in {@link PrepareStreamRequest}
 */
export type Address = {
  address: string;
  type?: 'v4' | 'v6';
}

export interface SourceResponse {
  port: number, // RTP/RTCP port of streaming server
  ssrc: number, // synchronization source of the stream

  srtp_key?: Buffer, // SRTP Key. Required if SRTP is used for the current stream
  srtp_salt?: Buffer, // SRTP Salt. Required if SRTP is used for the current stream
}

export interface ProxiedSourceResponse {
  proxy_pt: number, // Payload Type of input stream
  proxy_server_address: string, // IP address of RTP server
  proxy_server_rtp: number, // RTP port
  proxy_server_rtcp: number, // RTCP port
}

export const enum StreamRequestTypes {
  RECONFIGURE = 'reconfigure',
  START = 'start',
  STOP = 'stop',
}

export type StreamingRequest = StartStreamRequest | ReconfigureStreamRequest | StopStreamRequest;
/**
 * @deprecated replaced by {@link StreamingRequest}
 */
export type StreamRequest = {
  sessionID: SessionIdentifier;
  type: StreamRequestTypes;
  video?: VideoInfo;
  audio?: AudioInfo;
}

export type StartStreamRequest = {
  sessionID: StreamSessionIdentifier,
  type: StreamRequestTypes.START,
  video: VideoInfo,
  audio: AudioInfo,
}

export type ReconfigureStreamRequest = {
  sessionID: StreamSessionIdentifier,
  type: StreamRequestTypes.RECONFIGURE,
  video: ReconfiguredVideoInfo,
}

export type StopStreamRequest = {
  sessionID: StreamSessionIdentifier,
  type: StreamRequestTypes.STOP,
}

export type AudioInfo = {
  codec: AudioStreamingCodecType, // block size for AAC-ELD must be 480 samples

  channel: number,
  bit_rate: number,
  sample_rate: AudioStreamingSamplerate, // 8, 16, 24
  packet_time: number, // rtp packet time: length of time in ms represented by the media in a packet (20ms, 30ms, 40ms, 60ms)

  pt: number, // payloadType, typically 110
  ssrc: number, // synchronisation source
  max_bit_rate: number,
  rtcp_interval: number, // minimum rtcp interval in seconds (floating point number), pretty much always 0.5
  comfort_pt: number, // comfortNoise payloadType, 13

  comfortNoiseEnabled: boolean,
};

export type VideoInfo = {  // minimum keyframe interval is about 5 seconds
  profile: H264Profile,
  level: H264Level,
  packetizationMode: VideoCodecPacketizationMode,
  cvoId?: number, // Coordination of Video Orientation, only supplied if enabled AND supported; ranges from 1 to 14

  width: number,
  height: number,
  fps: number,

  pt: number, // payloadType, 99 for h264
  ssrc: number, // synchronisation source
  max_bit_rate: number,
  rtcp_interval: number, // minimum rtcp interval in seconds (floating point number), pretty much always 0.5 (standard says a rang from 0.5 to 1.5)
  mtu: number, // maximum transmissions unit, default values: ipv4: 1378 bytes; ipv6: 1228 bytes
};

export type ReconfiguredVideoInfo = {
  width: number,
  height: number,
  fps: number,

  max_bit_rate: number,
  rtcp_interval: number, // minimum rtcp interval in seconds (floating point number)
}

export class RTPStreamManagement {

  /**
   * @deprecated Please use the SRTPCryptoSuites const enum above. Scheduled to be removed in 2021-06.
   */
  // @ts-ignore
  static SRTPCryptoSuites = SRTPCryptoSuites;
  /**
   * @deprecated Please use the H264Profile const enum above. Scheduled to be removed in 2021-06.
   */
  // @ts-ignore
  static VideoCodecParamProfileIDTypes = H264Profile;
  /**
   * @deprecated won't be updated anymore. Please use the H264Level const enum above. Scheduled to be removed in 2021-06.
   */
  // @ts-ignore
  static VideoCodecParamLevelTypes = Object.freeze({ TYPE3_1: 0, TYPE3_2: 1, TYPE4_0: 2 });

  private readonly delegate: CameraStreamingDelegate;
  readonly service: CameraRTPStreamManagement; // must be public for backwards compatibility

  requireProxy: boolean;
  disableAudioProxy: boolean;
  supportedCryptoSuites: SRTPCryptoSuites[];
  videoOnly: boolean = false;

  readonly supportedRTPConfiguration: string;
  readonly supportedVideoStreamConfiguration: string;
  readonly supportedAudioStreamConfiguration: string;

  /**
   * @deprecated
   */
  connectionID?: SessionIdentifier;
  private activeConnection?: HAPConnection;
  private activeConnectionClosedListener?: () => void;
  sessionIdentifier?: StreamSessionIdentifier = undefined;
  streamStatus: StreamingStatus = StreamingStatus.AVAILABLE; // use _updateStreamStatus to update this property
  private ipVersion?: "ipv4" | "ipv6"; // ip version for the current session

  selectedConfiguration: string = ""; // base64 representation of the currently selected configuration
  setupEndpointsResponse: string = ""; // response of the SetupEndpoints Characteristic

  audioProxy?: RTPProxy;
  videoProxy?: RTPProxy;

  constructor(id: number, options: CameraStreamingOptions, delegate: CameraStreamingDelegate, service?: CameraRTPStreamManagement) {
    this.delegate = delegate;

    this.requireProxy = options.proxy || false;
    this.disableAudioProxy = options.disable_audio_proxy || false;
    if (isLegacySRTPOptions(options)) {
      this.supportedCryptoSuites = [options.srtp? SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80: SRTPCryptoSuites.NONE];
    } else {
      this.supportedCryptoSuites = options.supportedCryptoSuites;
    }

    if (this.supportedCryptoSuites.length === 0) {
      this.supportedCryptoSuites.push(SRTPCryptoSuites.NONE);
    }

    if (!options.video) {
      throw new Error('Video parameters cannot be undefined in options');
    }

    this.supportedRTPConfiguration = RTPStreamManagement._supportedRTPConfiguration(this.supportedCryptoSuites);
    this.supportedVideoStreamConfiguration = RTPStreamManagement._supportedVideoStreamConfiguration(options.video);
    this.supportedAudioStreamConfiguration = this._supportedAudioStreamConfiguration(options.audio);

    this.service = service || this.constructService(id);
    this.setupServiceHandlers();

    this.resetSetupEndpointsResponse();
    this.resetSelectedStreamConfiguration();
  }

  public forceStop() {
    this.handleSessionClosed();
  }

  getService(): CameraRTPStreamManagement {
    return this.service;
  }

  // noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
  /**
   * @deprecated
   */
  handleCloseConnection(connectionID: SessionIdentifier): void {
    // This method is only here for legacy compatibility. It used to be called by legacy style CameraSource
    // implementations to signal that the associated HAP connection was closed.
    // This is now handled automatically. Thus we don't need to do anything anymore.
  }

  handleFactoryReset() {
    this.resetSelectedStreamConfiguration();
    this.resetSetupEndpointsResponse();
    // on a factory reset the assumption is that all connections were already terminated and thus "handleStopStream" was already called
  }

  public destroy() {
    if (this.activeConnection) {
      this._handleStopStream();
    }
  }

  private constructService(id: number): CameraRTPStreamManagement {
    const managementService = new Service.CameraRTPStreamManagement('', id.toString());

    managementService.setCharacteristic(Characteristic.Active, true);
    managementService.setCharacteristic(Characteristic.SupportedRTPConfiguration, this.supportedRTPConfiguration);
    managementService.setCharacteristic(Characteristic.SupportedVideoStreamConfiguration, this.supportedVideoStreamConfiguration);
    managementService.setCharacteristic(Characteristic.SupportedAudioStreamConfiguration, this.supportedAudioStreamConfiguration);

    return managementService;
  }

  private setupServiceHandlers() {
    this._updateStreamStatus(StreamingStatus.AVAILABLE); // reset streaming status to available
    this.service.setCharacteristic(Characteristic.SetupEndpoints, this.setupEndpointsResponse); // reset SetupEndpoints to default

    this.service.getCharacteristic(Characteristic.SelectedRTPStreamConfiguration)!
      .on(CharacteristicEventTypes.GET, callback => {
        callback(null, this.selectedConfiguration);
      })
      .on(CharacteristicEventTypes.SET, this._handleSelectedStreamConfigurationWrite.bind(this));

    this.service.getCharacteristic(Characteristic.SetupEndpoints)!
      .on(CharacteristicEventTypes.GET, callback => {
        callback(null, this.setupEndpointsResponse);
      })
      .on(CharacteristicEventTypes.SET, (value, callback, context, connection) => {
        if (!connection) {
          debug("Set event handler for SetupEndpoints cannot be called from plugin. Connection undefined!");
          callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
          return;
        }
        this.handleSetupEndpoints(value, callback, connection);
      });
  }

  private handleSessionClosed(): void { // called when the streaming was ended or aborted and needs to be cleaned up
    this.resetSelectedStreamConfiguration();
    this.resetSetupEndpointsResponse();

    if (this.activeConnectionClosedListener && this.activeConnection) {
      this.activeConnection.removeListener(HAPConnectionEvent.CLOSED, this.activeConnectionClosedListener);
      this.activeConnectionClosedListener = undefined;
    }

    this._updateStreamStatus(StreamingStatus.AVAILABLE);
    this.sessionIdentifier = undefined;
    this.activeConnection = undefined;
    // noinspection JSDeprecatedSymbols
    this.connectionID = undefined;
    this.ipVersion = undefined;

    if (this.videoProxy) {
      this.videoProxy.destroy();
      this.videoProxy = undefined;
    }
    if (this.audioProxy) {
      this.audioProxy.destroy();
      this.audioProxy = undefined;
    }
  }

  private _handleSelectedStreamConfigurationWrite(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    const data = Buffer.from(value as string, 'base64');
    const objects = tlv.decode(data);

    const sessionControl = tlv.decode(objects[SelectedRTPStreamConfigurationTypes.SESSION_CONTROL]);
    const sessionIdentifier = uuid.unparse(sessionControl[SessionControlTypes.SESSION_IDENTIFIER]);
    const requestType: SessionControlCommand = sessionControl[SessionControlTypes.COMMAND][0];

    if (sessionIdentifier !== this.sessionIdentifier) {
      debug(`Received unknown session Identifier with request to ${SessionControlCommand[requestType]}`);
      callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
      return;
    }

    this.selectedConfiguration = value as string;

    // intercept the callback chain to check if an error occurred.
    const streamCallback: CharacteristicSetCallback = (error, writeResponse) => {
      callback(error, writeResponse); // does not support writeResponse, but how knows what comes in the future.
      if (error) {
        this.handleSessionClosed();
      }
    };

    switch (requestType) {
      case SessionControlCommand.START_SESSION:
        const selectedVideoParameters = tlv.decode(objects[SelectedRTPStreamConfigurationTypes.SELECTED_VIDEO_PARAMETERS]);
        const selectedAudioParameters = tlv.decode(objects[SelectedRTPStreamConfigurationTypes.SELECTED_AUDIO_PARAMETERS]);

        this._handleStartStream(selectedVideoParameters, selectedAudioParameters, streamCallback);
        break;
      case SessionControlCommand.RECONFIGURE_SESSION:
        const reconfiguredVideoParameters = tlv.decode(objects[SelectedRTPStreamConfigurationTypes.SELECTED_VIDEO_PARAMETERS]);

        this.handleReconfigureStream(reconfiguredVideoParameters, streamCallback);
        break;
      case SessionControlCommand.END_SESSION:
        this._handleStopStream(streamCallback);
        break;
      case SessionControlCommand.RESUME_SESSION:
      case SessionControlCommand.SUSPEND_SESSION:
      default:
        debug(`Unhandled request type ${SessionControlCommand[requestType]}`);
        callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
        return;
    }
  }

  private _handleStartStream(videoConfiguration: Record<number, Buffer>, audioConfiguration: Record<number, Buffer>, callback: CharacteristicSetCallback): void {
    // selected video configuration
    // noinspection JSUnusedLocalSymbols
    const videoCodec = videoConfiguration[SelectedVideoParametersTypes.CODEC_TYPE]; // always 0x00 for h264
    const videoParametersTLV = videoConfiguration[SelectedVideoParametersTypes.CODEC_PARAMETERS];
    const videoAttributesTLV = videoConfiguration[SelectedVideoParametersTypes.ATTRIBUTES];
    const videoRTPParametersTLV = videoConfiguration[SelectedVideoParametersTypes.RTP_PARAMETERS];

    // video parameters
    const videoParameters = tlv.decode(videoParametersTLV);
    const h264Profile: H264Profile = videoParameters[VideoCodecParametersTypes.PROFILE_ID][0];
    const h264Level: H264Level = videoParameters[VideoCodecParametersTypes.LEVEL][0];
    const packetizationMode: VideoCodecPacketizationMode = videoParameters[VideoCodecParametersTypes.PACKETIZATION_MODE][0];
    const cvoEnabled = videoParameters[VideoCodecParametersTypes.CVO_ENABLED];
    let cvoId: number | undefined = undefined;
    if (cvoEnabled && cvoEnabled[0] === VideoCodecCVO.SUPPORTED) {
      cvoId = videoParameters[VideoCodecParametersTypes.CVO_ID].readUInt8(0);
    }

    // video attributes
    const videoAttributes = tlv.decode(videoAttributesTLV);
    const width = videoAttributes[VideoAttributesTypes.IMAGE_WIDTH].readUInt16LE(0);
    const height = videoAttributes[VideoAttributesTypes.IMAGE_HEIGHT].readUInt16LE(0);
    const frameRate = videoAttributes[VideoAttributesTypes.FRAME_RATE].readUInt8(0);

    // video rtp parameters
    const videoRTPParameters = tlv.decode(videoRTPParametersTLV);
    const videoPayloadType = videoRTPParameters[VideoRTPParametersTypes.PAYLOAD_TYPE].readUInt8(0); // 99
    const videoSSRC = videoRTPParameters[VideoRTPParametersTypes.SYNCHRONIZATION_SOURCE].readUInt32LE(0);
    const videoMaximumBitrate = videoRTPParameters[VideoRTPParametersTypes.MAX_BIT_RATE].readUInt16LE(0);
    const videoRTCPInterval = videoRTPParameters[VideoRTPParametersTypes.MIN_RTCP_INTERVAL].readFloatLE(0);
    let maxMTU = this.ipVersion === "ipv6"? 1228: 1378; // default values ipv4: 1378 bytes; ipv6: 1228 bytes
    if (videoRTPParameters[VideoRTPParametersTypes.MAX_MTU]) {
      maxMTU = videoRTPParameters[VideoRTPParametersTypes.MAX_MTU].readUInt16LE(0);
    }


    // selected audio configuration
    const audioCodec: AudioCodecTypes = audioConfiguration[SelectedAudioParametersTypes.CODEC_TYPE][0];
    const audioParametersTLV = audioConfiguration[SelectedAudioParametersTypes.CODEC_PARAMETERS];
    const audioRTPParametersTLV = audioConfiguration[SelectedAudioParametersTypes.RTP_PARAMETERS];
    const comfortNoise = !!audioConfiguration[SelectedAudioParametersTypes.COMFORT_NOISE].readUInt8(0);

    // audio parameters
    const audioParameters = tlv.decode(audioParametersTLV);
    const channels = audioParameters[AudioCodecParametersTypes.CHANNEL][0];
    const audioBitrate: AudioBitrate = audioParameters[AudioCodecParametersTypes.BIT_RATE][0];
    const samplerate: AudioSamplerate = audioParameters[AudioCodecParametersTypes.SAMPLE_RATE][0];
    const rtpPacketTime = audioParameters[AudioCodecParametersTypes.PACKET_TIME].readUInt8(0);

    // audio rtp parameters
    const audioRTPParameters = tlv.decode(audioRTPParametersTLV);
    const audioPayloadType = audioRTPParameters[AudioRTPParametersTypes.PAYLOAD_TYPE].readUInt8(0); // 110
    const audioSSRC = audioRTPParameters[AudioRTPParametersTypes.SYNCHRONIZATION_SOURCE].readUInt32LE(0);
    const audioMaximumBitrate = audioRTPParameters[AudioRTPParametersTypes.MAX_BIT_RATE].readUInt16LE(0);
    const audioRTCPInterval = audioRTPParameters[AudioRTPParametersTypes.MIN_RTCP_INTERVAL].readFloatLE(0);
    const comfortNoisePayloadType = audioRTPParameters[AudioRTPParametersTypes.COMFORT_NOISE_PAYLOAD_TYPE].readUInt8(0); // 13

    if (this.requireProxy) {
      this.videoProxy!.setOutgoingPayloadType(videoPayloadType);
      if (!this.disableAudioProxy) {
        this.audioProxy!.setOutgoingPayloadType(audioPayloadType);
      }
    }


    const videoInfo: VideoInfo = {
      profile: h264Profile,
      level: h264Level,
      packetizationMode: packetizationMode,
      cvoId: cvoId,

      width: width,
      height: height,
      fps: frameRate,

      pt: videoPayloadType,
      ssrc: videoSSRC,
      max_bit_rate: videoMaximumBitrate,
      rtcp_interval: videoRTCPInterval,
      mtu: maxMTU,
    };

    let audioCodecName: AudioStreamingCodecType;
    let samplerateNum: AudioStreamingSamplerate;

    switch (audioCodec) {
      case AudioCodecTypes.PCMU:
        audioCodecName = AudioStreamingCodecType.PCMU;
        break;
      case AudioCodecTypes.PCMA:
        audioCodecName = AudioStreamingCodecType.PCMA;
        break;
      case AudioCodecTypes.AAC_ELD:
        audioCodecName = AudioStreamingCodecType.AAC_ELD;
        break;
      case AudioCodecTypes.OPUS:
        audioCodecName = AudioStreamingCodecType.OPUS;
        break;
      case AudioCodecTypes.MSBC:
        audioCodecName = AudioStreamingCodecType.MSBC;
        break;
      case AudioCodecTypes.AMR:
        audioCodecName = AudioStreamingCodecType.AMR;
        break;
      case AudioCodecTypes.AMR_WB:
        audioCodecName = AudioStreamingCodecType.AMR_WB;
        break;
      default:
        throw new Error(`Encountered unknown selected audio codec ${audioCodec}`);
    }

    switch (samplerate) {
      case AudioSamplerate.KHZ_8:
        samplerateNum = 8;
        break;
      case AudioSamplerate.KHZ_16:
        samplerateNum = 16;
        break;
      case AudioSamplerate.KHZ_24:
        samplerateNum = 24;
        break;
      default:
        throw new Error(`Encountered unknown selected audio samplerate ${samplerate}`);
    }

    const audioInfo: AudioInfo = {
      codec: audioCodecName,

      channel: channels,
      bit_rate: audioBitrate,
      sample_rate: samplerateNum,
      packet_time: rtpPacketTime,

      pt: audioPayloadType,
      ssrc: audioSSRC,
      max_bit_rate: audioMaximumBitrate,
      rtcp_interval: audioRTCPInterval,
      comfort_pt: comfortNoisePayloadType,

      comfortNoiseEnabled: comfortNoise,
    };

    const request: StartStreamRequest = {
      sessionID: this.sessionIdentifier!,
      type: StreamRequestTypes.START,
      video: videoInfo,
      audio: audioInfo,
    };

    this.delegate.handleStreamRequest(request, error => callback(error));
  }

  private handleReconfigureStream(videoConfiguration: Record<number, Buffer>, callback: CharacteristicSetCallback): void {
    // selected video configuration
    const videoAttributesTLV = videoConfiguration[SelectedVideoParametersTypes.ATTRIBUTES];
    const videoRTPParametersTLV = videoConfiguration[SelectedVideoParametersTypes.RTP_PARAMETERS];

    // video attributes
    const videoAttributes = tlv.decode(videoAttributesTLV);
    const width = videoAttributes[VideoAttributesTypes.IMAGE_WIDTH].readUInt16LE(0);
    const height = videoAttributes[VideoAttributesTypes.IMAGE_HEIGHT].readUInt16LE(0);
    const frameRate = videoAttributes[VideoAttributesTypes.FRAME_RATE].readUInt8(0);

    // video rtp parameters
    const videoRTPParameters = tlv.decode(videoRTPParametersTLV);
    const videoMaximumBitrate = videoRTPParameters[VideoRTPParametersTypes.MAX_BIT_RATE].readUInt16LE(0);
    const videoRTCPInterval = videoRTPParameters[VideoRTPParametersTypes.MIN_RTCP_INTERVAL].readFloatLE(0) || 0.5; // seems to be always zero, use default of 0.5

    const reconfiguredVideoInfo: ReconfiguredVideoInfo = {
      width: width,
      height: height,
      fps: frameRate,

      max_bit_rate: videoMaximumBitrate,
      rtcp_interval: videoRTCPInterval,
    };

    const request: ReconfigureStreamRequest = {
      sessionID: this.sessionIdentifier!,
      type: StreamRequestTypes.RECONFIGURE,
      video: reconfiguredVideoInfo,
    };

    this.delegate.handleStreamRequest(request, error => callback(error));
  }

  private _handleStopStream(callback?: CharacteristicSetCallback): void {
    const request: StopStreamRequest = {
      sessionID: this.sessionIdentifier!, // save sessionIdentifier before handleSessionClosed is called
      type: StreamRequestTypes.STOP,
    };

    this.handleSessionClosed();

    this.delegate.handleStreamRequest(request, error => callback? callback(error): undefined);
  }

  private handleSetupEndpoints(value: CharacteristicValue, callback: CharacteristicSetCallback, connection: HAPConnection): void {
    const data = Buffer.from(value as string, 'base64');
    const objects = tlv.decode(data);

    const sessionIdentifier = uuid.unparse(objects[SetupEndpointsTypes.SESSION_ID]);

    if (this.streamStatus !== StreamingStatus.AVAILABLE) {
      this.setupEndpointsResponse = tlv.encode(
          SetupEndpointsResponseTypes.SESSION_ID, uuid.write(sessionIdentifier),
          SetupEndpointsResponseTypes.STATUS, SetupEndpointsStatus.BUSY,
      ).toString("base64");
      callback();
      return;
    }

    this.activeConnection = connection;
    this.activeConnection.on(HAPConnectionEvent.CLOSED, (this.activeConnectionClosedListener = this._handleStopStream.bind(this)));

    // noinspection JSDeprecatedSymbols
    this.connectionID = connection.sessionID;
    this.sessionIdentifier = sessionIdentifier;
    this._updateStreamStatus(StreamingStatus.IN_USE);

    // Address
    const targetAddressPayload = objects[SetupEndpointsTypes.CONTROLLER_ADDRESS];
    const processedAddressInfo = tlv.decode(targetAddressPayload);
    const addressVersion = processedAddressInfo[AddressTypes.ADDRESS_VERSION][0];
    const controllerAddress = processedAddressInfo[AddressTypes.ADDRESS].toString('utf8');
    const targetVideoPort = processedAddressInfo[AddressTypes.VIDEO_RTP_PORT].readUInt16LE(0);
    const targetAudioPort = processedAddressInfo[AddressTypes.AUDIO_RTP_PORT].readUInt16LE(0);

    // Video SRTP Params
    const videoSRTPPayload = objects[SetupEndpointsTypes.VIDEO_SRTP_PARAMETERS];
    const processedVideoInfo = tlv.decode(videoSRTPPayload);
    const videoCryptoSuite = processedVideoInfo[SRTPParametersTypes.SRTP_CRYPTO_SUITE][0];
    const videoMasterKey = processedVideoInfo[SRTPParametersTypes.MASTER_KEY];
    const videoMasterSalt = processedVideoInfo[SRTPParametersTypes.MASTER_SALT];

    // Audio SRTP Params
    const audioSRTPPayload = objects[SetupEndpointsTypes.AUDIO_SRTP_PARAMETERS];
    const processedAudioInfo = tlv.decode(audioSRTPPayload);
    const audioCryptoSuite = processedAudioInfo[SRTPParametersTypes.SRTP_CRYPTO_SUITE][0];
    const audioMasterKey = processedAudioInfo[SRTPParametersTypes.MASTER_KEY];
    const audioMasterSalt = processedAudioInfo[SRTPParametersTypes.MASTER_SALT];

    debug(
      'Session: ', sessionIdentifier,
      '\nControllerAddress: ', controllerAddress,
      '\nVideoPort: ', targetVideoPort,
      '\nAudioPort: ', targetAudioPort,
      '\nVideo Crypto: ', videoCryptoSuite,
      '\nVideo Master Key: ', videoMasterKey,
      '\nVideo Master Salt: ', videoMasterSalt,
      '\nAudio Crypto: ', audioCryptoSuite,
      '\nAudio Master Key: ', audioMasterKey,
      '\nAudio Master Salt: ', audioMasterSalt
    );


    const prepareRequest: PrepareStreamRequest = {
      sessionID: sessionIdentifier,
      targetAddress: controllerAddress,
      addressVersion: addressVersion === IPAddressVersion.IPV6? "ipv6": "ipv4",

      video: { // if suite is NONE, keys and salts are zero-length
        port: targetVideoPort,

        srtpCryptoSuite: videoCryptoSuite,
        srtp_key: videoMasterKey,
        srtp_salt: videoMasterSalt,
      },
      audio: {
        port: targetAudioPort,

        srtpCryptoSuite: audioCryptoSuite,
        srtp_key: audioMasterKey,
        srtp_salt: audioMasterSalt,
      },
    };

    const promises: Promise<void>[] = [];

    if (this.requireProxy) {
      prepareRequest.targetAddress = connection.getLocalAddress(addressVersion === IPAddressVersion.IPV6? "ipv6": "ipv4"); // ip versions must be the same

      this.videoProxy = new RTPProxy({
        outgoingAddress: controllerAddress,
        outgoingPort: targetVideoPort,
        outgoingSSRC: crypto.randomBytes(4).readUInt32LE(0), // videoSSRC
        disabled: false
      });

      promises.push(this.videoProxy.setup().then(() => {
        prepareRequest.video.proxy_rtp = this.videoProxy!.incomingRTPPort();
        prepareRequest.video.proxy_rtcp = this.videoProxy!.incomingRTCPPort();
      }));

      if (!this.disableAudioProxy) {
        this.audioProxy = new RTPProxy({
          outgoingAddress: controllerAddress,
          outgoingPort: targetAudioPort,
          outgoingSSRC: crypto.randomBytes(4).readUInt32LE(0), // audioSSRC
          disabled: this.videoOnly
        });

        promises.push(this.audioProxy.setup().then(() => {
          prepareRequest.audio.proxy_rtp = this.audioProxy!.incomingRTPPort();
          prepareRequest.audio.proxy_rtcp = this.audioProxy!.incomingRTCPPort();
        }));
      }
    }

    Promise.all(promises).then(() => {
      this.delegate.prepareStream(prepareRequest, once((error?: Error, response?: PrepareStreamResponse) => {
        if (error || !response) {
          debug(`PrepareStream request encountered an error: ${error? error.message: undefined}`);
          this.setupEndpointsResponse = tlv.encode(
              SetupEndpointsResponseTypes.SESSION_ID, uuid.write(sessionIdentifier),
              SetupEndpointsResponseTypes.STATUS, SetupEndpointsStatus.ERROR,
          ).toString("base64");

          this.handleSessionClosed();
          callback(error);
        } else {
          this.generateSetupEndpointResponse(connection, sessionIdentifier, prepareRequest, response, callback);
        }
      }));
    });
  }

  private generateSetupEndpointResponse(connection: HAPConnection, identifier: StreamSessionIdentifier, request: PrepareStreamRequest, response: PrepareStreamResponse, callback: CharacteristicSetCallback): void {
    let address: string;
    let addressVersion = request.addressVersion;

    let videoPort: number;
    let audioPort: number;

    let videoCryptoSuite: SRTPCryptoSuites;
    let videoSRTPKey: Buffer;
    let videoSRTPSalt: Buffer;
    let audioCryptoSuite: SRTPCryptoSuites;
    let audioSRTPKey: Buffer;
    let audioSRTPSalt: Buffer;

    let videoSSRC: number;
    let audioSSRC: number;

    if (!this.videoOnly && !response.audio) {
      throw new Error("Audio was enabled but not supplied in PrepareStreamResponse!");
    }

    // Provide default values if audio was not supplied
    const audio: SourceResponse | ProxiedSourceResponse = response.audio || {
      port: request.audio.port,
      ssrc: CameraController.generateSynchronisationSource(),
      srtp_key: request.audio.srtp_key,
      srtp_salt: request.audio.srtp_salt,
    };

    if (!this.requireProxy) {
      const videoInfo = response.video as SourceResponse;
      const audioInfo = audio as SourceResponse;

      if (response.addressOverride) {
        addressVersion = net.isIPv4(response.addressOverride)? "ipv4": "ipv6";
        address = response.addressOverride;
      } else {
        address = connection.getLocalAddress(addressVersion);
      }

      if (request.addressVersion !== addressVersion) {
        throw new Error(`Incoming and outgoing ip address versions must match! Expected ${request.addressVersion} but got ${addressVersion}`);
      }

      videoPort = videoInfo.port;
      audioPort = audioInfo.port;


      if (request.video.srtpCryptoSuite !== SRTPCryptoSuites.NONE
          && (videoInfo.srtp_key === undefined || videoInfo.srtp_salt === undefined)) {
        throw new Error("SRTP was selected for the prepared video stream, but no 'srtp_key' or 'srtp_salt' was specified!");
      }
      if (request.audio.srtpCryptoSuite !== SRTPCryptoSuites.NONE
          && (audioInfo.srtp_key === undefined || audioInfo.srtp_salt === undefined)) {
        throw new Error("SRTP was selected for the prepared audio stream, but no 'srtp_key' or 'srtp_salt' was specified!");
      }

      videoCryptoSuite = request.video.srtpCryptoSuite;
      videoSRTPKey = videoInfo.srtp_key || Buffer.alloc(0); // key and salt are zero-length for cryptoSuite = NONE
      videoSRTPSalt = videoInfo.srtp_salt || Buffer.alloc(0);

      audioCryptoSuite = request.audio.srtpCryptoSuite;
      audioSRTPKey = audioInfo.srtp_key || Buffer.alloc(0); // key and salt are zero-length for cryptoSuite = NONE
      audioSRTPSalt = audioInfo.srtp_salt || Buffer.alloc(0);


      videoSSRC = videoInfo.ssrc;
      audioSSRC = audioInfo.ssrc;
    } else {
      const videoInfo = response.video as ProxiedSourceResponse;

      address = connection.getLocalAddress(request.addressVersion);


      videoCryptoSuite = SRTPCryptoSuites.NONE;
      videoSRTPKey = Buffer.alloc(0);
      videoSRTPSalt = Buffer.alloc(0);

      audioCryptoSuite = SRTPCryptoSuites.NONE;
      audioSRTPKey = Buffer.alloc(0);
      audioSRTPSalt = Buffer.alloc(0);


      this.videoProxy!.setIncomingPayloadType(videoInfo.proxy_pt);
      this.videoProxy!.setServerAddress(videoInfo.proxy_server_address);
      this.videoProxy!.setServerRTPPort(videoInfo.proxy_server_rtp);
      this.videoProxy!.setServerRTCPPort(videoInfo.proxy_server_rtcp);

      videoPort = this.videoProxy!.outgoingLocalPort();
      videoSSRC = this.videoProxy!.outgoingSSRC;

      if (!this.disableAudioProxy) {
        const audioInfo = response.audio as ProxiedSourceResponse;
        this.audioProxy!.setIncomingPayloadType(audioInfo.proxy_pt);
        this.audioProxy!.setServerAddress(audioInfo.proxy_server_address);
        this.audioProxy!.setServerRTPPort(audioInfo.proxy_server_rtp);
        this.audioProxy!.setServerRTCPPort(audioInfo.proxy_server_rtcp);

        audioPort = this.audioProxy!.outgoingLocalPort();
        audioSSRC = this.audioProxy!.outgoingSSRC;
      } else {
        const audioInfo = response.audio as SourceResponse;

        audioPort = audioInfo.port;
        audioSSRC = audioInfo.ssrc;
      }
    }
    this.ipVersion = addressVersion; // we need to save this in order to calculate some default mtu values later

    const accessoryAddress = tlv.encode(
        AddressTypes.ADDRESS_VERSION, addressVersion === "ipv4"? IPAddressVersion.IPV4: IPAddressVersion.IPV6,
        AddressTypes.ADDRESS, address,
        AddressTypes.VIDEO_RTP_PORT, tlv.writeUInt16(videoPort),
        AddressTypes.AUDIO_RTP_PORT, tlv.writeUInt16(audioPort)
    );

    const videoSRTPParameters = tlv.encode(
        SRTPParametersTypes.SRTP_CRYPTO_SUITE, videoCryptoSuite,
        SRTPParametersTypes.MASTER_KEY, videoSRTPKey,
        SRTPParametersTypes.MASTER_SALT, videoSRTPSalt
    );

    const audioSRTPParameters = tlv.encode(
        SRTPParametersTypes.SRTP_CRYPTO_SUITE, audioCryptoSuite,
        SRTPParametersTypes.MASTER_KEY, audioSRTPKey,
        SRTPParametersTypes.MASTER_SALT, audioSRTPSalt
    );

    this.setupEndpointsResponse = tlv.encode(
        SetupEndpointsResponseTypes.SESSION_ID, uuid.write(identifier),
        SetupEndpointsResponseTypes.STATUS, SetupEndpointsStatus.SUCCESS,
        SetupEndpointsResponseTypes.ACCESSORY_ADDRESS, accessoryAddress,
        SetupEndpointsResponseTypes.VIDEO_SRTP_PARAMETERS, videoSRTPParameters,
        SetupEndpointsResponseTypes.AUDIO_SRTP_PARAMETERS, audioSRTPParameters,
        SetupEndpointsResponseTypes.VIDEO_SSRC, tlv.writeUInt32(videoSSRC),
        SetupEndpointsResponseTypes.AUDIO_SSRC, tlv.writeUInt32(audioSSRC),
    ).toString("base64");
    callback();
  }

  private _updateStreamStatus(status: StreamingStatus): void {
    this.streamStatus = status;

    this.service.updateCharacteristic(Characteristic.StreamingStatus, tlv.encode(
          StreamingStatusTypes.STATUS, this.streamStatus
      ).toString('base64'));
  }

  private static _supportedRTPConfiguration(supportedCryptoSuites: SRTPCryptoSuites[]): string {
    if (supportedCryptoSuites.length === 1 && supportedCryptoSuites[0] === SRTPCryptoSuites.NONE) {
      debug("Client claims it doesn't support SRTP. The stream may stops working with future iOS releases.");
    }

    return tlv.encode(SupportedRTPConfigurationTypes.SRTP_CRYPTO_SUITE, supportedCryptoSuites).toString("base64");
  }

  private static _supportedVideoStreamConfiguration(videoOptions: VideoStreamingOptions): string {
    if (!videoOptions.codec) {
      throw new Error('Video codec cannot be undefined');
    }
    if (!videoOptions.resolutions) {
      throw new Error('Video resolutions cannot be undefined');
    }

    let codecParameters = tlv.encode(
      VideoCodecParametersTypes.PROFILE_ID, videoOptions.codec.profiles,
      VideoCodecParametersTypes.LEVEL, videoOptions.codec.levels,
      VideoCodecParametersTypes.PACKETIZATION_MODE, VideoCodecPacketizationMode.NON_INTERLEAVED,
    );

    if (videoOptions.cvoId != undefined) {
      codecParameters = Buffer.concat([
        codecParameters,
        tlv.encode(
          VideoCodecParametersTypes.CVO_ENABLED, VideoCodecCVO.SUPPORTED,
          VideoCodecParametersTypes.CVO_ID, videoOptions.cvoId,
        )
      ]);
    }

    const videoStreamConfiguration = tlv.encode(
      VideoCodecConfigurationTypes.CODEC_TYPE, VideoCodecType.H264,
      VideoCodecConfigurationTypes.CODEC_PARAMETERS, codecParameters,
      VideoCodecConfigurationTypes.ATTRIBUTES, videoOptions.resolutions.map(resolution => {
        if (resolution.length != 3) {
          throw new Error('Unexpected video resolution');
        }

        const width = Buffer.alloc(2);
        const height = Buffer.alloc(2);
        const frameRate = Buffer.alloc(1);

        width.writeUInt16LE(resolution[0], 0);
        height.writeUInt16LE(resolution[1], 0);
        frameRate.writeUInt8(resolution[2], 0);

        return tlv.encode(
          VideoAttributesTypes.IMAGE_WIDTH, width,
          VideoAttributesTypes.IMAGE_HEIGHT, height,
          VideoAttributesTypes.FRAME_RATE, frameRate,
        );
      }),
    );

    return tlv.encode(
      SupportedVideoStreamConfigurationTypes.VIDEO_CODEC_CONFIGURATION, videoStreamConfiguration,
    ).toString('base64');
  }

  private checkForLegacyAudioCodecRepresentation(codecs: AudioStreamingCodec[]) { // we basically merge the samplerates here
    const codecMap: Record<string, AudioStreamingCodec> = {};

    codecs.slice().forEach(codec => {
      const previous = codecMap[codec.type];

      if (previous) {
        if (typeof previous.samplerate === "number") {
          previous.samplerate = [previous.samplerate];
        }

        previous.samplerate = previous.samplerate.concat(codec.samplerate);

        const index = codecs.indexOf(codec);
        if (index >= 0) {
          codecs.splice(index, 1);
        }
      } else {
        codecMap[codec.type] = codec;
      }
    });
  }

  private _supportedAudioStreamConfiguration(audioOptions?: AudioStreamingOptions): string {
    // Only AAC-ELD and OPUS are accepted by iOS currently, and we need to give it something it will accept
    // for it to start the video stream.

    const comfortNoise = audioOptions && !!audioOptions.comfort_noise;
    const supportedCodecs: AudioStreamingCodec[] = (audioOptions && audioOptions.codecs) || [];
    this.checkForLegacyAudioCodecRepresentation(supportedCodecs);

    if (supportedCodecs.length === 0) { // Fake a Codec if we haven't got anything
      debug("Client doesn't support any audio codec that HomeKit supports.");
      this.videoOnly = true;

      supportedCodecs.push({
        type: AudioStreamingCodecType.OPUS, // Opus @16K required by Apple Watch AFAIK
        samplerate: [AudioStreamingSamplerate.KHZ_16, AudioStreamingSamplerate.KHZ_24], // 16 and 24 must be supported
      });
    }

    const codecConfigurations: Buffer[] = supportedCodecs.map(codec => {
      let type: AudioCodecTypes;

      switch (codec.type) {
        case AudioStreamingCodecType.OPUS:
          type = AudioCodecTypes.OPUS;
          break;
        case AudioStreamingCodecType.AAC_ELD:
          type = AudioCodecTypes.AAC_ELD;
          break;
        case AudioStreamingCodecType.PCMA:
          type = AudioCodecTypes.PCMA;
          break;
        case AudioStreamingCodecType.PCMU:
          type = AudioCodecTypes.PCMU;
          break;
        case AudioStreamingCodecType.MSBC:
          type = AudioCodecTypes.MSBC;
          break;
        case AudioStreamingCodecType.AMR:
          type = AudioCodecTypes.AMR;
          break;
        case AudioStreamingCodecType.AMR_WB:
          type = AudioCodecTypes.AMR_WB;
          break;
        default:
          throw new Error("Unsupported codec: " + codec.type);
      }

      const providedSamplerates = (typeof codec.samplerate === "number"? [codec.samplerate]: codec.samplerate).map(rate => {
        let samplerate;
        switch (rate) {
          case AudioStreamingSamplerate.KHZ_8:
            samplerate = AudioSamplerate.KHZ_8;
            break;
          case AudioStreamingSamplerate.KHZ_16:
            samplerate = AudioSamplerate.KHZ_16;
            break;
          case AudioStreamingSamplerate.KHZ_24:
            samplerate = AudioSamplerate.KHZ_24;
            break;
          default:
            console.log("Unsupported sample rate: ", codec.samplerate);
            samplerate = -1;
        }
        return samplerate;
      }).filter(rate => rate !== -1);

      if (providedSamplerates.length === 0) {
        throw new Error("Audio samplerate cannot be empty!");
      }

      const audioParameters = tlv.encode(
        AudioCodecParametersTypes.CHANNEL, Math.max(1, codec.audioChannels || 1),
        AudioCodecParametersTypes.BIT_RATE, codec.bitrate || AudioBitrate.VARIABLE,
        AudioCodecParametersTypes.SAMPLE_RATE, providedSamplerates,
      )

      return tlv.encode(
          AudioCodecConfigurationTypes.CODEC_TYPE, type,
          AudioCodecConfigurationTypes.CODEC_PARAMETERS, audioParameters
      );
    });

    return tlv.encode(
      SupportedAudioStreamConfigurationTypes.AUDIO_CODEC_CONFIGURATION, codecConfigurations,
      SupportedAudioStreamConfigurationTypes.COMFORT_NOISE_SUPPORT, comfortNoise? 1: 0,
    ).toString("base64");
  }

  private resetSetupEndpointsResponse(): void {
    this.setupEndpointsResponse = tlv.encode(
        SetupEndpointsResponseTypes.STATUS, SetupEndpointsStatus.ERROR,
    ).toString("base64");
    this.service.updateCharacteristic(Characteristic.SetupEndpoints, this.setupEndpointsResponse);
  }

  private resetSelectedStreamConfiguration(): void {
    this.selectedConfiguration = tlv.encode(
      SelectedRTPStreamConfigurationTypes.SESSION_CONTROL, tlv.encode(
        SessionControlTypes.COMMAND, SessionControlCommand.SUSPEND_SESSION,
      ),
    ).toString("base64");
    this.service.updateCharacteristic(Characteristic.SelectedRTPStreamConfiguration, this.selectedConfiguration);
  }

}

/**
 * @deprecated - only there for backwards compatibility, please use {@see RTPStreamManagement} directly
 */
export class StreamController extends RTPStreamManagement {

  /**
   *  options get saved so we can still support {@link configureCameraSource}
   */
  options: CameraStreamingOptions;

  // noinspection JSDeprecatedSymbols
  constructor(id: number, options: CameraStreamingOptions, delegate: LegacyCameraSource, service?: CameraRTPStreamManagement) {
    super(id, options, new LegacyCameraSourceAdapter(delegate), service);
    this.options = options;
  }

}
