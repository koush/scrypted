export interface ChannelsResponse {
    StreamingChannelList: StreamingChannelList;
}

export interface StreamingChannelList {
    $:                Empty;
    StreamingChannel: StreamingChannel[];
}

export interface Empty {
    version: string;
    xmlns:   string;
}

export interface StreamingChannel {
    $:           Empty;
    id:          string[];
    channelName: string[];
    enabled:     string[];
    Transport:   Transport[];
    Video:       Video[];
    Audio:       Audio[];
}

export interface Audio {
    enabled:              string[];
    audioInputChannelID:  string[];
    audioCompressionType: string[];
}

export interface Transport {
    maxPacketSize:       string[];
    ControlProtocolList: ControlProtocolList[];
    Unicast:             Unicast[];
    Multicast:           Multicast[];
    Security:            Security[];
}

export interface ControlProtocolList {
    ControlProtocol: ControlProtocol[];
}

export interface ControlProtocol {
    streamingTransport: string[];
}

export interface Multicast {
    enabled:         string[];
    destIPAddress:   string[];
    videoDestPortNo: string[];
    audioDestPortNo: string[];
}

export interface Security {
    enabled:           string[];
    certificateType:   string[];
    SecurityAlgorithm: SecurityAlgorithm[];
}

export interface SecurityAlgorithm {
    algorithmType: string[];
}

export interface Unicast {
    enabled:          string[];
    rtpTransportType: string[];
}

export interface Video {
    enabled:                 string[];
    videoInputChannelID:     string[];
    videoCodecType:          string[];
    videoScanType:           string[];
    videoResolutionWidth:    string[];
    videoResolutionHeight:   string[];
    videoQualityControlType: string[];
    constantBitRate:         string[];
    fixedQuality:            string[];
    vbrUpperCap:             string[];
    vbrLowerCap:             string[];
    maxFrameRate:            string[];
    keyFrameInterval:        string[];
    snapShotImageType:       string[];
    H264Profile:             string[];
    GovLength:               string[];
    SVC:                     SVC[];
    PacketType:              string[];
    smoothing:               string[];
    H265Profile:             string[];
    SmartCodec?:             SVC[];
}

export interface SVC {
    enabled: string[];
}

export interface ChannelResponse {
    StreamingChannel: StreamingChannel;
}


// {
//     enabled: [
//       "true",
//     ],
//     videoInputChannelID: [
//       "1",
//     ],
//     videoCodecType: [
//       "H.264",
//     ],
//     videoScanType: [
//       "progressive",
//     ],
//     videoResolutionWidth: [
//       "3840",
//     ],
//     videoResolutionHeight: [
//       "2160",
//     ],
//     videoQualityControlType: [
//       "VBR",
//     ],
//     constantBitRate: [
//       "8192",
//     ],
//     fixedQuality: [
//       "100",
//     ],
//     vbrUpperCap: [
//       "8192",
//     ],
//     vbrLowerCap: [
//       "32",
//     ],
//     maxFrameRate: [
//       "2000",
//     ],
//     keyFrameInterval: [
//       "4000",
//     ],
//     snapShotImageType: [
//       "JPEG",
//     ],
//     H264Profile: [
//       "Main",
//     ],
//     GovLength: [
//       "80",
//     ],
//     SVC: [
//       {
//         enabled: [
//           "false",
//         ],
//       },
//     ],
//     PacketType: [
//       "PS",
//       "RTP",
//     ],
//     smoothing: [
//       "50",
//     ],
//     H265Profile: [
//       "Main",
//     ],
//     SmartCodec: [
//       {
//         enabled: [
//           "false",
//         ],
//       },
//     ],
//   }

export interface ValueWithRange {
    _: string;
    $: {
        min: string;
        max: string;
    };
}

export interface SupplementLightRoot {
    SupplementLight: SupplementLight;
}

export interface SupplementLight {
    mode: string[];
    Schedule?: Schedule[];
    brightnessLimit: ValueWithRange[];
    supplementLightMode: string[];
    whiteLightBrightness?: ValueWithRange[];
}

export interface Schedule {
    TimeRange: TimeRange[];
}

export interface TimeRange {
    beginTime: string[];
    endTime: string[];
}

export interface BrightnessLimit {
    _: string;
    $: {
        min: string;
        max: string;
    };
}

export interface LightBrightness { 
    _: string;
    $: {
        min: string;
        max: string;
    }
}