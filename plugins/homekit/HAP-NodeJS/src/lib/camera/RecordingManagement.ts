import { Characteristic, CharacteristicEventTypes } from "../Characteristic"
import { CameraRecordingDelegate } from "../controller"
import { CameraRecordingManagement, SelectedCameraRecordingConfiguration } from "../definitions"
import { Service } from "../Service"
import { H264CodecParameters, H264Level, H264Profile, Resolution } from "./RTPStreamManagement"
import createDebug from 'debug';
import * as tlv from '../util/tlv';

const debug = createDebug('HAP-NodeJS:Camera:RecordingManagement');

export type CameraRecordingConfiguration = {
  mediaContainerConfiguration: MediaContainerConfiguration & {
    prebufferLength: number,
  },

  videoCodec: {
    iFrameInterval: number,
    level: H264Level,
    profile: H264Profile,
    resolution: Resolution,
    bitrate: number,
  },

  audioCodec: AudioRecordingCodec & {
    bitrate: number,
    samplerate: AudioRecordingSamplerate,
  },
}

export type CameraRecordingOptions = {
  prebufferLength: number;
  eventTriggerOptions: number;
  mediaContainerConfigurations: MediaContainerConfiguration[];

  video: VideoRecordingOptions,
  audio: AudioRecordingOptions,

  motionService?: boolean;
}

export type MediaContainerConfiguration = {
  type: number;
  fragmentLength: number;
}

export type VideoRecordingOptions = {
  // codec is defaulted to h264.
  codec: H264CodecParameters,
  resolutions: Resolution[],
}

export type AudioRecordingOptions = {
  codecs: AudioRecordingCodec[],
}

export type AudioRecordingCodec = {
  type: AudioRecordingCodecType,
  audioChannels: number, // default 1
  bitrateMode: AudioBitrate, // default VARIABLE, AAC-ELD or OPUS MUST support VARIABLE bitrate
  samplerate: AudioRecordingSamplerate[] | AudioRecordingSamplerate,
}

const enum AudioBitrate {
  VARIABLE = 0x00,
  CONSTANT = 0x01,
}

const enum VideoCodecConfigurationTypes {
  CODEC_TYPE = 0x01,
  CODEC_PARAMETERS = 0x02,
  ATTRIBUTES = 0x03,
}

const enum VideoCodecParametersTypes {
  PROFILE_ID = 0x01,
  LEVEL = 0x02,
  BITRATE = 0x03,
  IFRAME_INTERVAL = 0x04,
}

const enum VideoAttributesTypes {
  IMAGE_WIDTH = 0x01,
  IMAGE_HEIGHT = 0x02,
  FRAME_RATE = 0x03,
}

const enum VideoCodecType {
  H264 = 0x00,
}

const enum SelectedCameraRecordingConfigurationTypes {
  SELECTED_GENERAL_CONFIGURATION = 0x01,
  SELECTED_VIDEO_CONFIGURATION = 0x02,
  SELECTED_AUDIO_CONFIGURATION = 0x03,
}

export type AudioRecordingParameters = {
  audioChannels?: number, // default 1
  bitrate?: AudioBitrate, // default VARIABLE
  samplerate: AudioRecordingSamplerate[] | AudioRecordingSamplerate,
}

export const enum AudioRecordingCodecType { // codecs as defined by the HAP spec; only AAC-ELD and OPUS seem to work
  AAC_LC = 0,
  AAC_ELD = 1,
}

export const enum AudioRecordingSamplerate {
  KHZ_8 = 0,
  KHZ_16 = 1,
  KHZ_24 = 2,
  KHZ_32 = 3,
  KHZ_44_1 = 4,
  KHZ_48 = 5,
}

export const AudioRecordingSamplerateValues = {
  0: 8,
  1: 16,
  2: 24,
  3: 32,
  4: 44.1,
  5: 48,
};

const enum SupportedVideoRecordingConfigurationTypes {
  VIDEO_CODEC_CONFIGURATION = 0x01,
}

const enum SupportedCameraRecordingConfigurationTypes {
  PREBUFFER_LENGTH = 0x01,
  EVENT_TRIGGER_OPTIONS = 0x02,
  MEDIA_CONTAINER_CONFIGURATIONS = 0x03
}

const enum MediaContainerConfigurationTypes {
  MEDIA_CONTAINER_TYPE = 0x01,
  MEDIA_CONTAINER_PARAMETERS = 0x02,
}

const enum MediaContainerParameterTypes {
  FRAGMENT_LENGTH = 0x01,
}

const enum AudioCodecParametersTypes {
  CHANNEL = 0x01,
  BIT_RATE = 0x02,
  SAMPLE_RATE = 0x03,
  MAX_AUDIO_BITRATE = 0x04 // only present in selected audio codec parameters tlv
}

const enum AudioCodecConfigurationTypes {
  CODEC_TYPE = 0x01,
  CODEC_PARAMETERS = 0x02,
}

const enum SupportedAudioRecordingConfigurationTypes {
  AUDIO_CODEC_CONFIGURATION = 0x01,
}

export class RecordingManagement {
  delegate: CameraRecordingDelegate;
  service: CameraRecordingManagement;

  selectedConfiguration: string = ""; // base64 representation of the currently selected configuration

  readonly supportedCameraRecordingConfiguration: string;
  readonly supportedVideoRecordingConfiguration: string;
  readonly supportedAudioRecordingConfiguration: string;

  videoOnly = false;
  

  private static _supportedCameraRecordingConfiguration(options: CameraRecordingOptions): string {
    const eventTriggerOptions = Buffer.alloc(8);
    eventTriggerOptions.writeInt32LE(1, 0);
    const prebufferLength = Buffer.alloc(4);
    prebufferLength.writeInt32LE(options.prebufferLength, 0);
    return tlv.encode(SupportedCameraRecordingConfigurationTypes.PREBUFFER_LENGTH, prebufferLength,
      SupportedCameraRecordingConfigurationTypes.EVENT_TRIGGER_OPTIONS, eventTriggerOptions,
      SupportedCameraRecordingConfigurationTypes.MEDIA_CONTAINER_CONFIGURATIONS, options.mediaContainerConfigurations.map(config => {
        const fragmentLength = Buffer.alloc(4);
        fragmentLength.writeInt32LE(config.fragmentLength, 0);
        return tlv.encode(
          MediaContainerConfigurationTypes.MEDIA_CONTAINER_TYPE, config.type,
          MediaContainerConfigurationTypes.MEDIA_CONTAINER_PARAMETERS, tlv.encode(
              MediaContainerParameterTypes.FRAGMENT_LENGTH, fragmentLength,
            )
        );
      })).toString('base64');
  }

  private static _supportedVideoRecordingConfiguration(videoOptions: VideoRecordingOptions): string {
    if (!videoOptions.codec) {
      throw new Error('Video codec cannot be undefined');
    }
    if (!videoOptions.resolutions) {
      throw new Error('Video resolutions cannot be undefined');
    }

    let codecParameters = tlv.encode(
      VideoCodecParametersTypes.PROFILE_ID, videoOptions.codec.profiles,
      VideoCodecParametersTypes.LEVEL, videoOptions.codec.levels,
    );

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
      SupportedVideoRecordingConfigurationTypes.VIDEO_CODEC_CONFIGURATION, videoStreamConfiguration,
    ).toString('base64');
  }

  private _supportedAudioStreamConfiguration(audioOptions?: AudioRecordingOptions): string {
    // Only AAC-ELD and OPUS are accepted by iOS currently, and we need to give it something it will accept
    // for it to start the video stream.

    const supportedCodecs: AudioRecordingCodec[] = (audioOptions && audioOptions.codecs) || [];

    if (supportedCodecs.length === 0) { // Fake a Codec if we haven't got anything
      debug("Client doesn't support any audio codec that HomeKit supports.");
      this.videoOnly = true;

      supportedCodecs.push({
        type: AudioRecordingCodecType.AAC_LC,
        bitrateMode: 0,
        audioChannels: 1,
        samplerate: [AudioRecordingSamplerate.KHZ_16, AudioRecordingSamplerate.KHZ_24], // 16 and 24 must be supported
      });
    }

    const codecConfigurations: Buffer[] = supportedCodecs.map(codec => {
      const providedSamplerates = (typeof codec.samplerate === "number"? [codec.samplerate]: codec.samplerate);

      if (providedSamplerates.length === 0) {
        throw new Error("Audio samplerate cannot be empty!");
      }

      const audioParameters = tlv.encode(
        AudioCodecParametersTypes.CHANNEL, Math.max(1, codec.audioChannels || 1),
        AudioCodecParametersTypes.BIT_RATE, codec.bitrateMode || AudioBitrate.VARIABLE,
        AudioCodecParametersTypes.SAMPLE_RATE, providedSamplerates,
      )

      return tlv.encode(
          AudioCodecConfigurationTypes.CODEC_TYPE, codec.type,
          AudioCodecConfigurationTypes.CODEC_PARAMETERS, audioParameters
      );
    });

    return tlv.encode(
      SupportedAudioRecordingConfigurationTypes.AUDIO_CODEC_CONFIGURATION, codecConfigurations,
    ).toString("base64");
  }

  constructor(options: CameraRecordingOptions, delegate: CameraRecordingDelegate, service?: CameraRecordingManagement) {
    this.delegate = delegate;
    this.service = service || this.constructService();

    this.setupServiceHandlers();

    this.supportedCameraRecordingConfiguration = RecordingManagement._supportedCameraRecordingConfiguration(options);
    this.supportedVideoRecordingConfiguration = RecordingManagement._supportedVideoRecordingConfiguration(options.video);
    this.supportedAudioRecordingConfiguration = this._supportedAudioStreamConfiguration(options.audio);
  }

  private recordingAudioActive = true;
  private active = false;

  private constructService(): CameraRecordingManagement {
    const managementService = new Service.CameraRecordingManagement('', '');

    // koush
    managementService.getCharacteristic(Characteristic.Active)
    .on('get', callback => {
      callback(null, this.active)
    })
    .on('set', (value, callback) => {
      this.active = !!value;
      callback();
    });
    managementService.getCharacteristic(Characteristic.RecordingAudioActive)
    .on('get', callback => {
      callback(null, this.recordingAudioActive)
    })
    .on('set', (value, callback) => {
      this.recordingAudioActive = !!value;
      callback();
    });

    managementService.getCharacteristic(Characteristic.SupportedCameraRecordingConfiguration)
    .on('get', callback => {
      callback(null, this.supportedCameraRecordingConfiguration);
    });
    managementService.getCharacteristic(Characteristic.SupportedVideoRecordingConfiguration)
    .on('get', callback => {
      callback(null, this.supportedVideoRecordingConfiguration);
    });
    managementService.getCharacteristic(Characteristic.SupportedAudioRecordingConfiguration)
    .on('get', callback => {
      callback(null, this.supportedAudioRecordingConfiguration);
    });
    return managementService;
  }

  private setupServiceHandlers() {
    this.service.getCharacteristic(Characteristic.SelectedCameraRecordingConfiguration)!
      .on(CharacteristicEventTypes.GET, callback => {
        callback(null, this.selectedConfiguration);
      })
      .on(CharacteristicEventTypes.SET, (value, callback) => {
        this.selectedConfiguration = value.toString();
        callback();
      });
  }

  getSelectedConfiguration(): CameraRecordingConfiguration {
    const decoded = tlv.decode(Buffer.from(this.selectedConfiguration, 'base64'));
    const recording = tlv.decode(decoded[SelectedCameraRecordingConfigurationTypes.SELECTED_GENERAL_CONFIGURATION]);
    const video = tlv.decode(decoded[SelectedCameraRecordingConfigurationTypes.SELECTED_VIDEO_CONFIGURATION]);
    const audio = tlv.decode(decoded[SelectedCameraRecordingConfigurationTypes.SELECTED_AUDIO_CONFIGURATION]);

    const vcodec = video[VideoCodecConfigurationTypes.CODEC_TYPE][0];
    const vparameters = tlv.decode(video[VideoCodecConfigurationTypes.CODEC_PARAMETERS]);
    const vattributes = tlv.decode(video[VideoCodecConfigurationTypes.ATTRIBUTES]);

    const width = vattributes[VideoAttributesTypes.IMAGE_WIDTH].readInt16LE(0);
    const height = vattributes[VideoAttributesTypes.IMAGE_HEIGHT].readInt16LE(0);
    const framerate = vattributes[VideoAttributesTypes.FRAME_RATE][0];

    const profile = vparameters[VideoCodecParametersTypes.PROFILE_ID][0];
    const level = vparameters[VideoCodecParametersTypes.LEVEL][0];
    const videoBitrate = vparameters[VideoCodecParametersTypes.BITRATE].readInt32LE(0);
    const iFrameInterval = vparameters[VideoCodecParametersTypes.IFRAME_INTERVAL].readInt32LE(0);

    const prebufferLength = recording[SupportedCameraRecordingConfigurationTypes.PREBUFFER_LENGTH].readInt32LE(0);
    const mediaContainerConfiguration = tlv.decode(recording[SupportedCameraRecordingConfigurationTypes.MEDIA_CONTAINER_CONFIGURATIONS]);

    const containerType = mediaContainerConfiguration[MediaContainerConfigurationTypes.MEDIA_CONTAINER_TYPE][0];
    const mediaContainerParameters = tlv.decode(mediaContainerConfiguration[MediaContainerConfigurationTypes.MEDIA_CONTAINER_PARAMETERS]);

    const fragmentLength = mediaContainerParameters[MediaContainerParameterTypes.FRAGMENT_LENGTH].readInt32LE(0);

    const acodec = audio[AudioCodecConfigurationTypes.CODEC_TYPE][0];
    const audioParameters = tlv.decode(audio[AudioCodecConfigurationTypes.CODEC_PARAMETERS]);
    const audioChannels = audioParameters[AudioCodecParametersTypes.CHANNEL][0];
    const samplerate = audioParameters[AudioCodecParametersTypes.SAMPLE_RATE][0];
    const audioBitrateMode = audioParameters[AudioCodecParametersTypes.BIT_RATE][0];
    const audioBitrate = audioParameters[AudioCodecParametersTypes.MAX_AUDIO_BITRATE].readUInt32LE(0);

    return {
      mediaContainerConfiguration: {
        prebufferLength,
        type: containerType,
        fragmentLength,
      },
      videoCodec: {
        bitrate: videoBitrate,
        level,
        profile,
        resolution: [width, height, framerate],
        iFrameInterval,
      },
      audioCodec: {
        audioChannels,
        type: acodec,
        samplerate,
        bitrateMode: audioBitrateMode,
        bitrate: audioBitrate,
      },
    };
  }

  getService(): CameraRecordingManagement {
    return this.service;
  }
}