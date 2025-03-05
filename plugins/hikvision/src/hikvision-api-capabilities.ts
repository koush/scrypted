export interface CapabiltiesResponse {
    StreamingChannel: StreamingChannel
}

export interface StreamingChannel {
    $: GeneratedType
    id: Id[]
    channelName: ChannelName[]
    enabled: Enabled[]
    Transport: Transport[]
    Video: Video[]
    Audio: Audio[]
    isSpportDynamicCapWithCondition: string[]
}

export interface GeneratedType {
    version: string
    xmlns: string
}

export interface Id {
    _: string
    $: GeneratedType2
}

export interface GeneratedType2 {
    opt: string
}

export interface ChannelName {
    _: string
    $: GeneratedType3
}

export interface GeneratedType3 {
    min: string
    max: string
}

export interface Enabled {
    _: string
    $: GeneratedType4
}

export interface GeneratedType4 {
    opt: string
}

export interface Transport {
    maxPacketSize: MaxPacketSize[]
    ControlProtocolList: ControlProtocolList[]
    Multicast: Multicast[]
    Unicast: Unicast[]
    Security: Security[]
}

export interface MaxPacketSize {
    _: string
    $: GeneratedType5
}

export interface GeneratedType5 {
    opt: string
}

export interface ControlProtocolList {
    ControlProtocol: ControlProtocol[]
}

export interface ControlProtocol {
    streamingTransport: StreamingTransport[]
}

export interface StreamingTransport {
    _: string
    $: GeneratedType6
}

export interface GeneratedType6 {
    opt: string
}

export interface Multicast {
    enabled: Enabled2[]
    videoDestPortNo: VideoDestPortNo[]
    audioDestPortNo: AudioDestPortNo[]
}

export interface Enabled2 {
    $: GeneratedType7
}

export interface GeneratedType7 {
    opt: string
}

export interface VideoDestPortNo {
    $: GeneratedType8
}

export interface GeneratedType8 {
    min: string
    max: string
    default: string
}

export interface AudioDestPortNo {
    $: GeneratedType9
}

export interface GeneratedType9 {
    min: string
    max: string
    default: string
}

export interface Unicast {
    enabled: Enabled3[]
    rtpTransportType: RtpTransportType[]
}

export interface Enabled3 {
    _: string
    $: GeneratedType10
}

export interface GeneratedType10 {
    opt: string
}

export interface RtpTransportType {
    _: string
    $: GeneratedType11
}

export interface GeneratedType11 {
    opt: string
}

export interface Security {
    enabled: Enabled4[]
    certificateType: CertificateType[]
    SecurityAlgorithm: SecurityAlgorithm[]
}

export interface Enabled4 {
    _: string
    $: GeneratedType12
}

export interface GeneratedType12 {
    opt: string
}

export interface CertificateType {
    _: string
    $: GeneratedType13
}

export interface GeneratedType13 {
    opt: string
}

export interface SecurityAlgorithm {
    algorithmType: AlgorithmType[]
}

export interface AlgorithmType {
    $: GeneratedType14
}

export interface GeneratedType14 {
    opt: string
}

export interface Video {
    enabled: Enabled5[]
    videoInputChannelID: VideoInputChannelId[]
    videoCodecType: VideoCodecType[]
    videoScanType: VideoScanType[]
    videoResolutionWidth: VideoResolutionWidth[]
    videoResolutionHeight: VideoResolutionHeight[]
    videoQualityControlType: VideoQualityControlType[]
    constantBitRate: ConstantBitRate[]
    fixedQuality: FixedQuality[]
    vbrUpperCap: VbrUpperCap[]
    vbrLowerCap: string[]
    maxFrameRate: MaxFrameRate[]
    keyFrameInterval: KeyFrameInterval[]
    snapShotImageType: SnapShotImageType[]
    H264Profile: H264Profile[]
    GovLength: GovLength[]
    SVC: Svc[]
    smoothing: Smoothing[]
    H265Profile: H265Profile[]
}

export interface Enabled5 {
    _: string
    $: GeneratedType15
}

export interface GeneratedType15 {
    opt: string
}

export interface VideoInputChannelId {
    _: string
    $: GeneratedType16
}

export interface GeneratedType16 {
    opt: string
}

export interface VideoCodecType {
    _: string
    $: GeneratedType17
}

export interface GeneratedType17 {
    opt: string
}

export interface VideoScanType {
    _: string
    $: GeneratedType18
}

export interface GeneratedType18 {
    opt: string
}

export interface VideoResolutionWidth {
    _: string
    $: GeneratedType19
}

export interface GeneratedType19 {
    opt: string
}

export interface VideoResolutionHeight {
    _: string
    $: GeneratedType20
}

export interface GeneratedType20 {
    opt: string
}

export interface VideoQualityControlType {
    _: string
    $: GeneratedType21
}

export interface GeneratedType21 {
    opt: string
}

export interface ConstantBitRate {
    _: string
    $: GeneratedType22
}

export interface GeneratedType22 {
    min: string
    max: string
}

export interface FixedQuality {
    _: string
    $: GeneratedType23
}

export interface GeneratedType23 {
    opt: string
}

export interface VbrUpperCap {
    _: string
    $: GeneratedType24
}

export interface GeneratedType24 {
    min: string
    max: string
}

export interface MaxFrameRate {
    _: string
    $: GeneratedType25
}

export interface GeneratedType25 {
    opt: string
}

export interface KeyFrameInterval {
    _: string
    $: GeneratedType26
}

export interface GeneratedType26 {
    min: string
    max: string
}

export interface SnapShotImageType {
    _: string
    $: GeneratedType27
}

export interface GeneratedType27 {
    opt: string
}

export interface H264Profile {
    _: string
    $: GeneratedType28
}

export interface GeneratedType28 {
    opt: string
}

export interface GovLength {
    _: string
    $: GeneratedType29
}

export interface GeneratedType29 {
    min: string
    max: string
}

export interface Svc {
    enabled: Enabled6[]
    SVCMode: Svcmode[]
}

export interface Enabled6 {
    _: string
    $: GeneratedType30
}

export interface GeneratedType30 {
    opt: string
}

export interface Svcmode {
    _: string
    $: GeneratedType31
}

export interface GeneratedType31 {
    opt: string
}

export interface Smoothing {
    _: string
    $: GeneratedType32
}

export interface GeneratedType32 {
    min: string
    max: string
}

export interface H265Profile {
    _: string
    $: GeneratedType33
}

export interface GeneratedType33 {
    opt: string
}

export interface Audio {
    enabled: Enabled7[]
    audioInputChannelID: string[]
    audioCompressionType: AudioCompressionType[]
}

export interface Enabled7 {
    _: string
    $: GeneratedType34
}

export interface GeneratedType34 {
    opt: string
}

export interface AudioCompressionType {
    _: string
    $: GeneratedType35
}

export interface GeneratedType35 {
    opt: string
}

export interface PtzCapabilitiesRoot {
    PTZChanelCap: PTZChanelCap;
}

export interface PTZChanelCap {
    AbsolutePanTiltPositionSpace: AbsolutePanTiltPositionSpaceClass;
    AbsoluteZoomPositionSpace: AbsoluteZoomPositionSpaceClass;
    ContinuousPanTiltSpace: AbsolutePanTiltPositionSpaceClass;
    ContinuousZoomSpace: AbsoluteZoomPositionSpaceClass;
    maxPresetNum: string;
    maxPatrolNum: string;
    maxPatternNum: string;
    maxLimitesNum: string;
    maxTimeTaskNum: string;
    controlProtocol: ControlProtocol;
    controlAddress: string;
    PTZRs485Para: PTZRs485Para;
    PresetNameCap: PresetNameCap;
    wiperStatusSupport: string;
    isSupportPosition3D: string;
    manualControlSpeed: ManualControlSpeed;
    isSpportPtzlimiteds: string;
    oneKeyParkAction: string;
    oneKeyMenu: string;
    ParkAction: ParkAction;
    TimeTaskList: TimeTaskList;
    TrackInitPosition: TrackInitPosition;
    LockPT: string;
    LFPositionCap: LFPositionCap;
    isSupportManualWiper: string;
    _xmlns: string;
    _version: string;
}

export interface AbsolutePanTiltPositionSpaceClass {
    XRange: Range;
    YRange: Range;
}

export interface Range {
    Min: string;
    Max: string;
}

export interface AbsoluteZoomPositionSpaceClass {
    ZRange: Range;
}

export interface LFPositionCap {
    elevation: AbsoluteZoom;
    azimuth: AbsoluteZoom;
    absoluteZoom: AbsoluteZoom;
}

export interface AbsoluteZoom {
    _min: string;
    _max: string;
    __text: string;
}

export interface PTZRs485Para {
    baudRate: ControlProtocol;
    dataBits: ControlProtocol;
    parityType: ControlProtocol;
    stopBits: ControlProtocol;
    flowCtrl: ControlProtocol;
    _xmlns: string;
    _version: string;
}

export interface ControlProtocol {
    _opt: string;
    __text: string;
}

export interface ParkAction {
    enabled: ControlProtocol;
    Parktime: AbsoluteZoom;
    Action: Action;
    _xmlns: string;
    _version: string;
}

export interface Action {
    ActionType: ControlProtocol;
    ActionNum: AbsoluteZoom;
}

export interface PresetNameCap {
    presetNameSupport: string;
    maxPresetNameLen: MaxPresetNameLen;
    specialNo: ManualControlSpeed;
    _xmlns: string;
    _version: string;
}

export interface MaxPresetNameLen {
    _max: string;
}

export interface ManualControlSpeed {
    _opt: string;
}

export interface TimeTaskList {
    enabled: ControlProtocol;
    TimeTaskBlock: TimeTaskBlock[];
    _xmlns: string;
    _version: string;
}

export interface TimeTaskBlock {
    dayOfWeek: AbsoluteZoom;
    TimeTaskRange: TimeTaskRange[];
    _xmlns: string;
    _version: string;
}

export interface TimeTaskRange {
    TaskID: AbsoluteZoom;
    Task: Task;
}

export interface Task {
    TaskType: ControlProtocol;
    presetTaskNum: AbsoluteZoom;
}

export interface TrackInitPosition {
    slaveCameraID: SlaveCameraID;
}

export interface SlaveCameraID {
    _min: string;
    _max: string;
}