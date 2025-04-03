from __future__ import annotations
from enum import Enum
try:
    from typing import TypedDict, Mapping
except:
    from typing_extensions import TypedDict, Mapping
from typing import Union, Any, AsyncGenerator

from .other import *


class AirPurifierMode(str, Enum):

    Automatic = "Automatic"
    Manual = "Manual"

class AirPurifierStatus(str, Enum):

    Active = "Active"
    ActiveNightMode = "ActiveNightMode"
    Idle = "Idle"
    Inactive = "Inactive"

class AirQuality(str, Enum):

    Excellent = "Excellent"
    Fair = "Fair"
    Good = "Good"
    Inferior = "Inferior"
    Poor = "Poor"
    Unknown = "Unknown"

class ChargeState(str, Enum):

    Charging = "charging"
    NotCharging = "not-charging"
    Trickle = "trickle"

class FanMode(str, Enum):

    Auto = "Auto"
    Manual = "Manual"

class HumidityMode(str, Enum):

    Auto = "Auto"
    Dehumidify = "Dehumidify"
    Humidify = "Humidify"
    Off = "Off"

class LockState(str, Enum):

    Jammed = "Jammed"
    Locked = "Locked"
    Unlocked = "Unlocked"

class MediaPlayerState(str, Enum):

    Buffering = "Buffering"
    Idle = "Idle"
    Paused = "Paused"
    Playing = "Playing"

class PanTiltZoomMovement(str, Enum):

    Absolute = "Absolute"
    Continuous = "Continuous"
    Home = "Home"
    Preset = "Preset"
    Relative = "Relative"

class ScryptedDeviceType(str, Enum):

    AirPurifier = "AirPurifier"
    API = "API"
    Automation = "Automation"
    Bridge = "Bridge"
    Builtin = "Builtin"
    Camera = "Camera"
    DataSource = "DataSource"
    DeviceProvider = "DeviceProvider"
    Display = "Display"
    Doorbell = "Doorbell"
    Entry = "Entry"
    Event = "Event"
    Fan = "Fan"
    Garage = "Garage"
    Internal = "Internal"
    Internet = "Internet"
    Irrigation = "Irrigation"
    Light = "Light"
    Lock = "Lock"
    Network = "Network"
    Notifier = "Notifier"
    Outlet = "Outlet"
    PasswordControl = "PasswordControl"
    Person = "Person"
    Program = "Program"
    RemoteDesktop = "RemoteDesktop"
    Scene = "Scene"
    SecuritySystem = "SecuritySystem"
    Sensor = "Sensor"
    Siren = "Siren"
    SmartDisplay = "SmartDisplay"
    SmartSpeaker = "SmartSpeaker"
    Speaker = "Speaker"
    Switch = "Switch"
    Thermostat = "Thermostat"
    Unknown = "Unknown"
    Vacuum = "Vacuum"
    Valve = "Valve"
    WindowCovering = "WindowCovering"

class ScryptedInterface(str, Enum):

    AirPurifier = "AirPurifier"
    AirQualitySensor = "AirQualitySensor"
    AmbientLightSensor = "AmbientLightSensor"
    AudioSensor = "AudioSensor"
    AudioVolumeControl = "AudioVolumeControl"
    Battery = "Battery"
    BinarySensor = "BinarySensor"
    Brightness = "Brightness"
    BufferConverter = "BufferConverter"
    Buttons = "Buttons"
    Camera = "Camera"
    Charger = "Charger"
    ClusterForkInterface = "ClusterForkInterface"
    CO2Sensor = "CO2Sensor"
    ColorSettingHsv = "ColorSettingHsv"
    ColorSettingRgb = "ColorSettingRgb"
    ColorSettingTemperature = "ColorSettingTemperature"
    DeviceCreator = "DeviceCreator"
    DeviceDiscovery = "DeviceDiscovery"
    DeviceProvider = "DeviceProvider"
    Display = "Display"
    Dock = "Dock"
    EngineIOHandler = "EngineIOHandler"
    Entry = "Entry"
    EntrySensor = "EntrySensor"
    EventRecorder = "EventRecorder"
    Fan = "Fan"
    FilterMaintenance = "FilterMaintenance"
    FloodSensor = "FloodSensor"
    HttpRequestHandler = "HttpRequestHandler"
    HumiditySensor = "HumiditySensor"
    HumiditySetting = "HumiditySetting"
    Intercom = "Intercom"
    LauncherApplication = "LauncherApplication"
    Lock = "Lock"
    LuminanceSensor = "LuminanceSensor"
    MediaConverter = "MediaConverter"
    MediaPlayer = "MediaPlayer"
    Microphone = "Microphone"
    MixinProvider = "MixinProvider"
    MotionSensor = "MotionSensor"
    Notifier = "Notifier"
    NOXSensor = "NOXSensor"
    OauthClient = "OauthClient"
    ObjectDetection = "ObjectDetection"
    ObjectDetectionGenerator = "ObjectDetectionGenerator"
    ObjectDetectionPreview = "ObjectDetectionPreview"
    ObjectDetector = "ObjectDetector"
    ObjectTracker = "ObjectTracker"
    OccupancySensor = "OccupancySensor"
    Online = "Online"
    OnOff = "OnOff"
    PanTiltZoom = "PanTiltZoom"
    PasswordStore = "PasswordStore"
    Pause = "Pause"
    PM10Sensor = "PM10Sensor"
    PM25Sensor = "PM25Sensor"
    PositionSensor = "PositionSensor"
    PowerSensor = "PowerSensor"
    PressButtons = "PressButtons"
    Program = "Program"
    PushHandler = "PushHandler"
    Readme = "Readme"
    Reboot = "Reboot"
    Refresh = "Refresh"
    RTCSignalingChannel = "RTCSignalingChannel"
    RTCSignalingClient = "RTCSignalingClient"
    Scene = "Scene"
    Scriptable = "Scriptable"
    ScryptedDevice = "ScryptedDevice"
    ScryptedDeviceCreator = "ScryptedDeviceCreator"
    ScryptedPlugin = "ScryptedPlugin"
    ScryptedPluginRuntime = "ScryptedPluginRuntime"
    ScryptedSettings = "ScryptedSettings"
    ScryptedSystemDevice = "ScryptedSystemDevice"
    ScryptedUser = "ScryptedUser"
    SecuritySystem = "SecuritySystem"
    Sensors = "Sensors"
    Settings = "Settings"
    Sleep = "Sleep"
    StartStop = "StartStop"
    StreamService = "StreamService"
    TamperSensor = "TamperSensor"
    TemperatureSetting = "TemperatureSetting"
    Thermometer = "Thermometer"
    TTY = "TTY"
    TTYSettings = "TTYSettings"
    UltravioletSensor = "UltravioletSensor"
    VideoCamera = "VideoCamera"
    VideoCameraConfiguration = "VideoCameraConfiguration"
    VideoCameraMask = "VideoCameraMask"
    VideoClips = "VideoClips"
    VideoFrameGenerator = "VideoFrameGenerator"
    VideoRecorder = "VideoRecorder"
    VideoRecorderManagement = "VideoRecorderManagement"
    VideoTextOverlays = "VideoTextOverlays"
    VOCSensor = "VOCSensor"

class ScryptedMimeTypes(str, Enum):

    FFmpegInput = "x-scrypted/x-ffmpeg-input"
    FFmpegTranscodeStream = "x-scrypted/x-ffmpeg-transcode-stream"
    Image = "x-scrypted/x-scrypted-image"
    InsecureLocalUrl = "text/x-insecure-local-uri"
    LocalUrl = "text/x-local-uri"
    MediaObject = "x-scrypted/x-scrypted-media-object"
    MediaStreamFeedback = "x-scrypted/x-media-stream-feedback"
    MediaStreamUrl = "text/x-media-url"
    PushEndpoint = "text/x-push-endpoint"
    RequestMediaObject = "x-scrypted/x-scrypted-request-media-object"
    RequestMediaStream = "x-scrypted/x-scrypted-request-stream"
    RTCConnectionManagement = "x-scrypted/x-scrypted-rtc-connection-management"
    RTCSignalingChannel = "x-scrypted/x-scrypted-rtc-signaling-channel"
    RTCSignalingSession = "x-scrypted/x-scrypted-rtc-signaling-session"
    SchemePrefix = "x-scrypted/x-scrypted-scheme-"
    ServerId = "text/x-server-id"
    Url = "text/x-uri"

class SecuritySystemMode(str, Enum):

    AwayArmed = "AwayArmed"
    Disarmed = "Disarmed"
    HomeArmed = "HomeArmed"
    NightArmed = "NightArmed"

class SecuritySystemObstruction(str, Enum):

    Error = "Error"
    Occupied = "Occupied"
    Sensor = "Sensor"
    Time = "Time"

class TemperatureUnit(str, Enum):

    C = "C"
    F = "F"

class ThermostatMode(str, Enum):

    Auto = "Auto"
    Cool = "Cool"
    Dry = "Dry"
    Eco = "Eco"
    FanOnly = "FanOnly"
    Heat = "Heat"
    HeatCool = "HeatCool"
    Off = "Off"
    On = "On"
    Purifier = "Purifier"


class H264Info(TypedDict):

    fuab: bool
    mtap16: bool
    mtap32: bool
    reserved0: bool
    reserved30: bool
    reserved31: bool
    sei: bool
    stapb: bool

class ImageOptions(TypedDict):

    crop: Any
    format: str
    resize: Any

class ObjectDetectionHistory(TypedDict):

    firstSeen: float
    lastSeen: float

class Resource(TypedDict):

    file: str
    href: str

class ClipPath(TypedDict):

    pass


class AudioStreamOptions(TypedDict):

    bitrate: float
    codec: str
    encoder: str
    profile: str
    sampleRate: float

class ClusterFork(TypedDict):

    clusterWorkerId: str
    id: str
    labels: Any
    runtime: str

class HttpResponseOptions(TypedDict):

    code: float
    headers: object

class NotificationAction(TypedDict):

    action: str
    icon: str
    title: str

class ObjectDetectionResult(TypedDict):

    boundingBox: tuple[float, float, float, float]  # x, y, width, height
    className: str  # The detection class of the object.
    clipPaths: list[ClipPath]  # The detection clip paths that outlines various features or segments, like traced facial features.
    clipped: bool  # Flag that indicates whether the detection was clipped by the detection input and may not be a full bounding box.
    cost: float  # The certainty that this is correct tracked object.
    embedding: str  # Base64 encoded embedding float32 vector.
    history: ObjectDetectionHistory
    id: str  # The id of the tracked object.
    label: str  # The label of the object, if it was recognized as a familiar object (person, pet, etc).
    labelScore: float  # The score of the label.
    landmarks: list[Point]  # The detection landmarks, like key points in a face landmarks.
    movement: Union[ObjectDetectionHistory, Any]  # Movement history will track the first/last time this object was moving.
    resources: VideoResource
    score: float
    zones: list[str]

class ObjectDetectionZone(TypedDict):

    classes: list[str]
    exclusion: bool
    path: ClipPath
    type: Any | Any

class PictureDimensions(TypedDict):

    height: float
    width: float

class PrivacyMask(TypedDict):

    name: str
    points: list[Point]

class RequestAudioStreamOptions(TypedDict):

    alternateCodecs: list[str]
    bitrate: float
    codec: str
    encoder: str
    profile: str
    sampleRate: float

class RequestMediaStreamAdaptiveOptions(TypedDict):

    codecSwitch: bool
    keyframe: bool
    packetLoss: bool
    pictureLoss: bool
    reconfigure: bool
    resize: bool

class RequestVideoStreamOptions(TypedDict):

    alternateCodecs: list[str]
    bitrate: float
    bitrateControl: Any | Any
    clientHeight: float
    clientWidth: float
    codec: str
    fps: float
    h264Info: H264Info
    height: float
    keyframeInterval: float  # Key Frame interval in frames.
    maxBitrate: float
    minBitrate: float
    profile: str
    quality: float
    width: float

class ScryptedDeviceAccessControl(TypedDict):
    """ScryptedDeviceAccessControl describes the methods and properties on a device that will be visible to the user. If methods is nullish, the user will be granted full access to all methods. If properties is nullish, the user will be granted full access to all properties. If events is nullish, the user will be granted full access to all events."""

    id: str
    interfaces: list[str]
    methods: list[str]
    properties: list[str]

class VideoResource(TypedDict):

    thumbnail: Resource
    video: Resource

class VideoStreamConfiguration(TypedDict):

    bitrate: float
    bitrateControl: Any | Any
    bitrateControls: list[str]
    bitrateRange: tuple[float, float]
    codec: str
    codecs: list[str]
    fps: float
    fpsRange: tuple[float, float]
    h264Info: H264Info
    height: float
    keyframeInterval: float  # Key Frame interval in frames.
    keyframeIntervalRange: tuple[float, float]
    maxBitrate: float
    minBitrate: float
    profile: str
    profiles: list[str]
    quality: float
    qualityRange: tuple[float, float]
    resolutions: list[tuple[float, float]]
    width: float

class VideoStreamOptions(TypedDict):

    bitrate: float
    bitrateControl: Any | Any
    codec: str
    fps: float
    h264Info: H264Info
    height: float
    keyframeInterval: float  # Key Frame interval in frames.
    maxBitrate: float
    minBitrate: float
    profile: str
    quality: float
    width: float

class MediaStreamDestination(TypedDict):

    pass


class MediaStreamSource(TypedDict):

    pass


class MediaStreamTool(TypedDict):

    pass


class Point(TypedDict):

    pass


class AdoptDevice(TypedDict):

    nativeId: str
    settings: DeviceCreatorSettings

class AirPurifierState(TypedDict):

    lockPhysicalControls: bool
    mode: AirPurifierMode
    speed: float
    status: AirPurifierStatus

class AudioVolumes(TypedDict):

    pass


class ClusterForkInterfaceOptions(TypedDict):

    clusterWorkerId: str  # The id of the cluster worker id that will execute this fork.
    id: str  # The id of the device that is associated with this fork.
    nativeId: str  # The native id of the mixin that is associated with this fork.

class ClusterWorker(TypedDict):

    address: str
    forks: list[ClusterFork]
    id: str
    labels: list[str]
    mode: Any | Any
    name: str

class ColorHsv(TypedDict):
    """Represents an HSV color value component."""

    h: float  # Hue. 0 to 360.
    s: float  # Saturation. 0 to 1.
    v: float  # Value. 0 to 1.

class ColorRgb(TypedDict):
    """Represents an RGB color with component values between 0 and 255."""

    b: float
    g: float
    r: float

class DeleteRecordingStreamOptions(TypedDict):

    destination: MediaStreamDestination
    duration: float
    startTime: float

class Device(TypedDict):
    """Device objects are created by DeviceProviders when new devices are discover and synced to Scrypted via the DeviceManager."""

    info: DeviceInformation
    interfaces: list[str]
    name: str
    nativeId: str  # The native id that is used by the DeviceProvider used to internally identify provided devices.
    providerNativeId: str  # The native id of the hub or discovery DeviceProvider that manages this device.
    refresh: bool  # Directs Scrypted to purge any previously returned instances of the device and call getDevice on the DeviceProvider.
    room: str
    type: str

class DeviceCreatorSettings(TypedDict):

    pass


class DeviceInformation(TypedDict):

    deeplink: Any
    description: str
    firmware: str
    ip: str
    mac: str
    managementUrl: str
    manufacturer: str
    metadata: Any
    model: str
    serialNumber: str
    version: str

class DeviceManifest(TypedDict):
    """DeviceManifest is passed to DeviceManager.onDevicesChanged to sync a full list of devices from the controller/hub (Hue, SmartThings, etc)"""

    devices: list[Device]
    providerNativeId: str  # The native id of the hub or discovery DeviceProvider that manages these devices.

class DiscoveredDevice(TypedDict):

    description: str  # Identifying information such as IP Address or Serial Number.
    info: DeviceInformation
    interfaces: list[str]
    name: str
    nativeId: str
    settings: list[Setting]
    type: str

class EndpointAccessControlAllowOrigin(TypedDict):

    nativeId: str
    origins: list[str]

class EventDetails(TypedDict):

    eventId: str
    eventInterface: str
    eventTime: float
    mixinId: str
    property: str

class EventListenerOptions(TypedDict):

    denoise: bool  # This EventListener will denoise events, and will not be called unless the state changes.
    event: str  # The EventListener will subscribe to this event interface.
    mixinId: str  # The EventListener will listen to events and property changes from a device or mixin that is suppressed by a mixin.
    watch: bool  # This EventListener will passively watch for events, and not initiate polling.

class FanState(TypedDict):

    counterClockwise: bool
    mode: FanMode
    speed: float
    swing: bool

class FanStatus(TypedDict):

    active: bool
    availableModes: list[FanMode]
    counterClockwise: bool
    maxSpeed: float  # Rotations per minute, if available.
    mode: FanMode
    speed: float  # Rotations per minute, if available, otherwise 0 or 1.
    swing: bool

class FFmpegInput(TypedDict):

    container: str
    env: Any  # Environment variables to set when launching FFmpeg.
    ffmpegPath: str  # Path to a custom FFmpeg binary.
    h264EncoderArguments: list[str]
    inputArguments: list[str]
    mediaStreamOptions: ResponseMediaStreamOptions
    url: str  # The media url for this FFmpegInput.
    urls: list[str]  # Alternate media urls for this FFmpegInput.

class HttpRequest(TypedDict):

    aclId: str
    body: str
    headers: Any
    isPublicEndpoint: bool
    method: str
    rootPath: str
    url: str
    username: str

class HumidityCommand(TypedDict):

    dehumidifierSetpoint: float
    humidifierSetpoint: float
    mode: HumidityMode

class HumiditySettingStatus(TypedDict):

    activeMode: HumidityMode
    availableModes: list[HumidityMode]
    dehumidifierSetpoint: float
    humidifierSetpoint: float
    mode: HumidityMode

class LauncherApplicationInfo(TypedDict):

    cloudHref: str
    description: str
    href: str
    icon: str  # Supports: mdi-icon, fa-icon, urls.
    name: str

class MediaObjectOptions(TypedDict):

    sourceId: str  # The device id of the source of the MediaObject.

class MediaPlayerOptions(TypedDict):

    autoplay: bool
    mimeType: str
    title: str

class MediaStatus(TypedDict):

    duration: float
    mediaPlayerState: MediaPlayerState
    metadata: Any
    position: float

class MediaStreamConfiguration(TypedDict):

    audio: AudioStreamOptions
    id: str
    video: VideoStreamConfiguration

class MediaStreamOptions(TypedDict):
    """Options passed to VideoCamera.getVideoStream to request specific media formats. The audio/video properties may be omitted to indicate no audio/video is available when calling getVideoStreamOptions or no audio/video is requested when calling getVideoStream."""

    audio: AudioStreamOptions
    container: str  # The container type of this stream, ie: mp4, mpegts, rtsp.
    id: str
    metadata: Any  # Stream specific metadata.
    name: str
    prebuffer: float  # Prebuffer time in milliseconds.
    prebufferBytes: float  # Prebuffer size in bytes.
    tool: MediaStreamTool  # The tool was used to write the container or will be used to read teh container. Ie, scrypted, the ffmpeg tools, gstreamer.
    video: VideoStreamOptions

class NotifierOptions(TypedDict):

    actions: list[NotificationAction]
    android: Any
    badge: str
    body: str
    bodyWithSubtitle: str
    critical: bool
    data: Any
    dir: NotificationDirection
    image: str
    lang: str
    recordedEvent: Union[RecordedEvent, Any]
    renotify: bool
    requireInteraction: bool
    silent: bool
    subtitle: str
    tag: str  # Collapse key/id.
    timestamp: float
    vibrate: VibratePattern

class ObjectDetectionGeneratorResult(TypedDict):

    __json_copy_serialize_children: Any
    detected: ObjectsDetected
    videoFrame: VideoFrame

class ObjectDetectionGeneratorSession(TypedDict):

    clusterWorkerId: str
    settings: Any
    sourceId: str
    zones: list[ObjectDetectionZone]

class ObjectDetectionModel(TypedDict):

    classes: list[str]  # Classes of objects that can be recognized. This can include motion or the names of specific people.
    decoder: bool
    inputFormat: Any | Any | Any
    inputSize: list[float]
    name: str
    prebuffer: float
    settings: list[Setting]
    triggerClasses: list[str]

class ObjectDetectionSession(TypedDict):

    batch: float  # Denotes that this is the first sample in a batch of samples.
    clusterWorkerId: str
    settings: Any
    sourceId: str
    zones: list[ObjectDetectionZone]

class ObjectDetectionTypes(TypedDict):

    classes: list[str]  # Classes of objects that can be recognized. This can include motion or the names of specific people.

class ObjectsDetected(TypedDict):

    detectionId: str  # The id for the detection session.
    detections: list[ObjectDetectionResult]
    inputDimensions: tuple[float, float]
    resources: VideoResource
    timestamp: float

class PanTiltZoomCapabilities(TypedDict):

    pan: bool
    presets: Any  # Preset id mapped to friendly name.
    tilt: bool
    zoom: bool

class PanTiltZoomCommand(TypedDict):

    movement: PanTiltZoomMovement  # Specify the movement type. If unspecified, the movement will be relative to the current position.
    pan: float  # Ranges between -1 and 1.
    preset: str  # The preset to move to.
    speed: Any  # The speed of the movement.
    tilt: float  # Ranges between -1 and 1.
    timeout: float  # The duration of the movement in milliseconds.
    zoom: float  # Ranges between 0 and 1 for max zoom.

class Position(TypedDict):

    accuracyRadius: float  # The accuracy radius of this position in meters.
    latitude: float
    longitude: float

class PrivacyMasks(TypedDict):

    masks: list[PrivacyMask]

class RecordedEvent(TypedDict):

    data: Any
    details: EventDetails

class RecordedEventOptions(TypedDict):

    count: float
    endTime: float
    startTime: float

class RecordingStreamThumbnailOptions(TypedDict):

    crop: Any
    detectionId: str
    resize: Any

class RequestMediaStreamOptions(TypedDict):
    """Options passed to VideoCamera.getVideoStream to request specific media formats. The audio/video properties may be omitted to indicate no audio/video is available when calling getVideoStreamOptions or no audio/video is requested when calling getVideoStream."""

    adaptive: bool | RequestMediaStreamAdaptiveOptions  # Request an adaptive bitrate stream, if available. The destination will need to report packet loss indication.
    audio: RequestAudioStreamOptions
    container: str  # The container type of this stream, ie: mp4, mpegts, rtsp.
    destination: MediaStreamDestination  # The intended destination for this media stream. May be used as a hint to determine which main/substream to send if no id is explicitly provided.
    destinationId: str  # The destination id for this media stream. This should generally be the IP address of the destination, if known. May be used by to determine stream selection and track dynamic bitrate history.
    destinationType: str  # The destination type of the target of this media stream. This should be the calling application package name. Used for logging or adaptive bitrate fingerprinting.
    id: str
    metadata: Any  # Stream specific metadata.
    name: str
    prebuffer: float  # Prebuffer time in milliseconds.
    prebufferBytes: float  # Prebuffer size in bytes.
    refresh: bool  # Specify the stream refresh behavior when this stream is requested. Use case is primarily for perioidic snapshot of streams while they are active.
    route: Any | Any | Any  # When retrieving media, setting route directs how the media should be retrieved and exposed. A direct route will get the stream as is from the source. This will bypass any intermediaries if possible, such as an NVR or restreamers. An external route will request that that provided route is exposed to the local network.
    tool: MediaStreamTool  # The tool was used to write the container or will be used to read teh container. Ie, scrypted, the ffmpeg tools, gstreamer.
    video: RequestVideoStreamOptions

class RequestPictureOptions(TypedDict):

    bulkRequest: bool  # Flag that hints whether multiple cameras are being refreshed by this user request. Can be used to prefetch the snapshots.
    id: str
    periodicRequest: bool  # Flag that hints whether this user request is happening due to a periodic refresh.
    picture: PictureDimensions  # The native dimensions of the camera.
    reason: Any | Any  # periodic: The requestor will request the snapshot periodically so a recent cached image may be returned. event: The requestor needs an image for event processing or thumbnail. Cached or error images will not be returned.
    timeout: float  # The maximum time in milliseconds to wait for the picture.

class RequestRecordingStreamOptions(TypedDict):
    """Options passed to VideoCamera.getVideoStream to request specific media formats. The audio/video properties may be omitted to indicate no audio/video is available when calling getVideoStreamOptions or no audio/video is requested when calling getVideoStream."""

    adaptive: bool | RequestMediaStreamAdaptiveOptions  # Request an adaptive bitrate stream, if available. The destination will need to report packet loss indication.
    audio: RequestAudioStreamOptions
    container: str  # The container type of this stream, ie: mp4, mpegts, rtsp.
    destination: MediaStreamDestination  # The intended destination for this media stream. May be used as a hint to determine which main/substream to send if no id is explicitly provided.
    destinationId: str  # The destination id for this media stream. This should generally be the IP address of the destination, if known. May be used by to determine stream selection and track dynamic bitrate history.
    destinationType: str  # The destination type of the target of this media stream. This should be the calling application package name. Used for logging or adaptive bitrate fingerprinting.
    duration: float
    id: str
    loop: bool
    metadata: Any  # Stream specific metadata.
    name: str
    playbackRate: float
    prebuffer: float  # Prebuffer time in milliseconds.
    prebufferBytes: float  # Prebuffer size in bytes.
    refresh: bool  # Specify the stream refresh behavior when this stream is requested. Use case is primarily for perioidic snapshot of streams while they are active.
    route: Any | Any | Any  # When retrieving media, setting route directs how the media should be retrieved and exposed. A direct route will get the stream as is from the source. This will bypass any intermediaries if possible, such as an NVR or restreamers. An external route will request that that provided route is exposed to the local network.
    startTime: float
    tool: MediaStreamTool  # The tool was used to write the container or will be used to read teh container. Ie, scrypted, the ffmpeg tools, gstreamer.
    video: RequestVideoStreamOptions

class ResponseMediaStreamOptions(TypedDict):
    """Options passed to VideoCamera.getVideoStream to request specific media formats. The audio/video properties may be omitted to indicate no audio/video is available when calling getVideoStreamOptions or no audio/video is requested when calling getVideoStream."""

    allowBatteryPrebuffer: bool  # Set this to true to allow for prebuffering even if the device implements the Battery interface. Handy if you have a device that can continuously prebuffer when on mains power, but you still want battery status reported.
    audio: AudioStreamOptions
    container: str  # The container type of this stream, ie: mp4, mpegts, rtsp.
    destinations: list[MediaStreamDestination]
    id: str
    metadata: Any  # Stream specific metadata.
    name: str
    oobCodecParameters: bool  # The stream's codec parameters are not contained in the stream and are available out of band via another mechanism such as the SDP.
    prebuffer: float  # Prebuffer time in milliseconds.
    prebufferBytes: float  # Prebuffer size in bytes.
    refreshAt: float  # The time in milliseconds that this stream must be refreshed again via a call to getVideoStream.
    sdp: str
    source: MediaStreamSource
    tool: MediaStreamTool  # The tool was used to write the container or will be used to read teh container. Ie, scrypted, the ffmpeg tools, gstreamer.
    userConfigurable: bool
    video: VideoStreamOptions

class ResponsePictureOptions(TypedDict):

    canResize: bool  # Flag that indicates that the request supports resizing to custom dimensions.
    id: str
    name: str
    picture: PictureDimensions  # The native dimensions of the camera.
    staleDuration: float  # Flag that indicates the camera will return a stale/cached image.

class ScriptSource(TypedDict):

    language: str
    monacoEvalDefaults: str
    name: str
    script: str

class ScryptedRuntimeArguments(TypedDict):

    arguments: list[str]
    executable: str

class ScryptedSystemDeviceInfo(TypedDict):

    deviceCreator: str  # The description of device that will be created by this DeviceCreator. For example: Example Corp Camera or ACME Light Switch.
    deviceDiscovery: str
    settings: str  # The name of the device as seen in System Settings.

class ScryptedUserAccessControl(TypedDict):
    """ScryptedUserAccessControl describes the list of devices that may be accessed by the user."""

    devicesAccessControls: list[ScryptedDeviceAccessControl]  # If devicesAccessControls is null, the user has full access to all devices.

class SecuritySystemState(TypedDict):

    mode: SecuritySystemMode
    obstruction: SecuritySystemObstruction
    supportedModes: list[SecuritySystemMode]
    triggered: bool

class Sensor(TypedDict):

    name: str
    unit: str
    value: str | float

class Setting(TypedDict):

    choices: list[str]
    combobox: bool
    console: bool  # Flag that hte UI should open the console.
    description: str
    deviceFilter: str
    group: str
    icon: str
    icons: list[str]
    immediate: bool  # Flag that the UI should immediately apply this setting.
    key: str
    multiple: bool
    placeholder: str
    radioGroups: list[str]
    range: tuple[float, float]  # The range of allowed numbers or dates/times, if any, when the type is number, timerange, or daterange, or datetimerange.
    readonly: bool
    subgroup: str
    title: str
    type: Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any
    value: SettingValue

class TemperatureCommand(TypedDict):

    mode: ThermostatMode
    setpoint: float | tuple[float, float]

class TemperatureSettingStatus(TypedDict):

    activeMode: ThermostatMode
    availableModes: list[ThermostatMode]
    mode: ThermostatMode
    setpoint: float | tuple[float, float]

class VideoClip(TypedDict):

    description: str
    detectionClasses: list[str]
    duration: float
    event: str
    id: str
    resources: VideoResource
    startTime: float
    thumbnailId: str
    videoId: str

class VideoClipOptions(TypedDict):

    aspectRatio: float
    count: float
    endTime: float
    startTime: float

class VideoClipThumbnailOptions(TypedDict):

    aspectRatio: float

class VideoFrame(TypedDict):

    __json_copy_serialize_children: Any
    image: Union[Image, MediaObject]
    timestamp: float

class VideoFrameGeneratorOptions(TypedDict):

    clusterWorkerId: str
    crop: Any
    firstFrameOnly: bool
    format: str
    fps: float
    queue: float
    resize: Any

class VideoTextOverlay(TypedDict):

    fontSize: float
    origin: Point  # The top left position of the overlay in the image, normalized to 0-1.
    readonly: bool
    text: str | bool  # The text value to set the overlay to, if it is not readonly. True or false otherwise to enable/disable.

class MediaConverterTypes(TypedDict):
    """[fromMimeType, toMimeType]"""

    pass


class TamperState(TypedDict):

    pass


TYPES_VERSION = "0.5.12"


class AirPurifier:

    airPurifierState: AirPurifierState
    async def setAirPurifierState(self, state: AirPurifierState) -> None:
        pass


class AirQualitySensor:

    airQuality: AirQuality

class AmbientLightSensor:

    ambientLight: float  # The ambient light in lux.

class AudioSensor:

    audioDetected: bool

class AudioVolumeControl:

    audioVolumes: AudioVolumes
    async def setAudioVolumes(self, audioVolumes: AudioVolumes) -> None:
        pass


class Battery:
    """Battery retrieves the battery level of battery powered devices."""

    batteryLevel: float

class BinarySensor:

    binaryState: bool

class Brightness:
    """Brightness is a lighting device that can be dimmed/lit between 0 to 100."""

    brightness: float
    async def setBrightness(self, brightness: float) -> None:
        pass


class BufferConverter:
    """Add a converter to be used by Scrypted to convert buffers from one mime type to another mime type. May optionally accept string urls if accept-url is a fromMimeType parameter."""

    fromMimeType: str
    toMimeType: str
    async def convert(self, data: Any, fromMimeType: str, toMimeType: str, options: MediaObjectOptions = None) -> Any:
        pass


class Buttons:

    buttons: list[str]

class Camera:
    """Camera devices can take still photos."""

    async def getPictureOptions(self) -> list[ResponsePictureOptions]:
        pass

    async def takePicture(self, options: RequestPictureOptions = None) -> MediaObject:
        pass


class Charger:
    """Charger reports whether or not a device is being charged from an external power source. Usually used for battery powered devices."""

    chargeState: ChargeState

class ClusterForkInterface:
    """Requests that the ScryptedDevice create a fork to"""

    async def forkInterface(self, forkInterface: ObjectDetection, options: ClusterForkInterfaceOptions = None) -> ObjectDetection:
        pass


class CO2Sensor:

    co2ppm: float

class ColorSettingHsv:
    """ColorSettingHsv sets the color of a colored light using the HSV representation."""

    hsv: ColorHsv
    async def setHsv(self, hue: float, saturation: float, value: float) -> None:
        pass


class ColorSettingRgb:
    """ColorSettingRgb sets the color of a colored light using the RGB representation."""

    rgb: ColorRgb
    async def setRgb(self, r: float, g: float, b: float) -> None:
        pass


class ColorSettingTemperature:
    """ColorSettingTemperature sets the color temperature of a light in Kelvin."""

    colorTemperature: float
    async def getTemperatureMaxK(self) -> float:
        pass

    async def getTemperatureMinK(self) -> float:
        pass

    async def setColorTemperature(self, kelvin: float) -> None:
        pass


class DeviceCreator:
    """A DeviceProvider that allows the user to create a device."""

    async def createDevice(self, settings: DeviceCreatorSettings) -> str:
        pass

    async def getCreateDeviceSettings(self) -> list[Setting]:
        pass


class DeviceDiscovery:
    """A DeviceProvider that has a device discovery mechanism."""

    async def adoptDevice(self, device: AdoptDevice) -> str:
        pass

    async def discoverDevices(self, scan: bool = None) -> list[DiscoveredDevice]:
        pass


class DeviceProvider:
    """DeviceProvider acts as a controller/hub and exposes multiple devices to Scrypted Device Manager."""

    async def getDevice(self, nativeId: str) -> Any:
        pass

    async def releaseDevice(self, id: str, nativeId: str) -> None:
        pass


class Display:
    """Display devices can play back audio and video."""

    async def startDisplay(self, media: MediaObject) -> None:
        pass

    async def stopDisplay(self) -> None:
        pass


class Dock:
    """Dock instructs devices that have a base station or charger, to return to their home."""

    docked: bool
    async def dock(self) -> None:
        pass


class EngineIOHandler:

    async def onConnection(self, request: HttpRequest, webSocket: WebSocket) -> None:
        pass


class Entry:
    """Entry represents devices that can open and close barriers, such as garage doors."""

    async def closeEntry(self) -> None:
        pass

    async def openEntry(self) -> None:
        pass


class EntrySensor:

    entryOpen: bool | Any

class EventRecorder:

    async def getRecordedEvents(self, options: RecordedEventOptions) -> list[RecordedEvent]:
        pass


class Fan:

    fan: FanStatus
    async def setFan(self, fan: FanState) -> None:
        pass


class FilterMaintenance:

    filterChangeIndication: bool
    filterLifeLevel: float

class FloodSensor:

    flooded: bool

class HttpRequestHandler:
    """The HttpRequestHandler allows handling of web requests under the endpoint path: /endpoint/npm-package-name/*."""

    async def onRequest(self, request: HttpRequest, response: HttpResponse) -> None:
        pass


class HumiditySensor:

    humidity: float

class HumiditySetting:

    humiditySetting: HumiditySettingStatus
    async def setHumidity(self, humidity: HumidityCommand) -> None:
        pass


class Intercom:
    """Intercom devices can playback audio."""

    async def startIntercom(self, media: MediaObject) -> None:
        pass

    async def stopIntercom(self) -> None:
        pass


class LauncherApplication:

    applicationInfo: LauncherApplicationInfo

class Lock:
    """Lock controls devices that can lock or unlock entries. Often works in tandem with PasswordControl."""

    lockState: LockState
    async def lock(self) -> None:
        pass

    async def unlock(self) -> None:
        pass


class LuminanceSensor:

    luminance: float

class MediaConverter:

    converters: list[MediaConverterTypes]
    async def convertMedia(self, data: Any, fromMimeType: str, toMimeType: str, options: MediaObjectOptions = None) -> Any:
        pass


class MediaPlayer:
    """MediaPlayer allows media playback on screen or speaker devices, such as Chromecasts or TVs."""

    async def getMediaStatus(self) -> MediaStatus:
        pass

    async def load(self, media: str | MediaObject, options: MediaPlayerOptions = None) -> None:
        pass

    async def seek(self, milliseconds: float) -> None:
        pass

    async def skipNext(self) -> None:
        pass

    async def skipPrevious(self) -> None:
        pass


class Microphone:
    """Microphone devices can capture audio streams."""

    async def getAudioStream(self) -> MediaObject:
        pass


class MixinProvider:
    """MixinProviders can add and intercept interfaces to other devices to add or augment their behavior."""

    async def canMixin(self, type: str, interfaces: list[str]) -> None | list[str]:
        pass

    async def getMixin(self, mixinDevice: Any, mixinDeviceInterfaces: list[ScryptedInterface], mixinDeviceState: WritableDeviceState) -> Any:
        pass

    async def releaseMixin(self, id: str, mixinDevice: Any) -> None:
        pass


class MotionSensor:

    motionDetected: bool

class Notifier:
    """Notifier can be any endpoint that can receive messages, such as speakers, phone numbers, messaging clients, etc. The messages may optionally contain media."""

    async def sendNotification(self, title: str, options: NotifierOptions = None, media: str | MediaObject = None, icon: str | MediaObject = None) -> None:
        pass


class NOXSensor:

    noxDensity: float

class OauthClient:
    """The OauthClient can be implemented to perform the browser based Oauth process from within a plugin."""

    async def getOauthUrl(self) -> str:
        pass

    async def onOauthCallback(self, callbackUrl: str) -> None:
        pass


class ObjectDetection:
    """ObjectDetection can run classifications or analysis on arbitrary media sources. E.g. TensorFlow, OpenCV, or a Coral TPU."""

    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None) -> ObjectsDetected:
        pass

    async def generateObjectDetections(self, videoFrames: MediaObject | AsyncGenerator[VideoFrame, None], session: ObjectDetectionGeneratorSession) -> AsyncGenerator[ObjectDetectionGeneratorResult, None]:
        pass

    async def getDetectionModel(self, settings: Any = None) -> ObjectDetectionModel:
        pass


class ObjectDetectionGenerator:


    pass

class ObjectDetectionPreview:


    pass

class ObjectDetector:
    """ObjectDetector is found on Cameras that have smart detection capabilities."""

    async def getDetectionInput(self, detectionId: str, eventId: Any = None) -> MediaObject:
        pass

    async def getObjectTypes(self) -> ObjectDetectionTypes:
        pass


class ObjectTracker:
    """Given object detections with bounding boxes, return a similar list with tracker ids."""

    async def trackObjects(self, detection: ObjectsDetected) -> ObjectsDetected:
        pass


class OccupancySensor:

    occupied: bool

class Online:
    """Online denotes whether the device is online or unresponsive. It may be unresponsive due to being unplugged, network error, etc."""

    online: bool

class OnOff:
    """OnOff is a basic binary switch."""

    on: bool
    async def turnOff(self) -> None:
        pass

    async def turnOn(self) -> None:
        pass


class PanTiltZoom:

    ptzCapabilities: PanTiltZoomCapabilities
    async def ptzCommand(self, command: PanTiltZoomCommand) -> None:
        pass


class PasswordStore:
    """PasswordControl represents devices that authorize users via a passcode or pin code."""

    async def addPassword(self, password: str) -> None:
        pass

    async def getPasswords(self) -> list[str]:
        pass

    async def removePassword(self, password: str) -> None:
        pass


class Pause:

    paused: bool
    async def pause(self) -> None:
        pass

    async def resume(self) -> None:
        pass


class PM10Sensor:

    pm10Density: float

class PM25Sensor:

    pm25Density: float

class PositionSensor:

    position: Position

class PowerSensor:

    powerDetected: bool

class PressButtons:

    async def pressButton(self, button: str) -> None:
        pass


class Program:

    async def run(self, variables: Any = None) -> Any:
        pass


class PushHandler:

    async def onPush(self, request: HttpRequest) -> None:
        pass


class Readme:

    async def getReadmeMarkdown(self) -> str:
        pass


class Reboot:

    async def reboot(self) -> None:
        pass


class Refresh:
    """Refresh indicates that this device has properties that are not automatically updated, and must be periodically refreshed via polling. Device implementations should never implement their own underlying polling algorithm, and instead implement Refresh to allow Scrypted to manage polling intelligently."""

    async def getRefreshFrequency(self) -> float:
        pass

    async def refresh(self, refreshInterface: str, userInitiated: bool) -> None:
        pass


class Scene:
    """Scenes control multiple different devices into a given state."""

    async def activate(self) -> None:
        pass

    async def deactivate(self) -> None:
        pass

    def isReversible(self) -> bool:
        pass


class Scriptable:

    async def eval(self, source: ScriptSource, variables: Any = None) -> Any:
        pass

    async def loadScripts(self) -> Any:
        pass

    async def saveScript(self, script: ScriptSource) -> None:
        pass


class ScryptedDevice:
    """All devices in Scrypted implement ScryptedDevice, which contains the id, name, and type. Add listeners to subscribe to events from that device."""

    id: str
    info: DeviceInformation
    interfaces: list[str]
    mixins: list[str]
    name: str
    nativeId: str
    pluginId: str
    providedInterfaces: list[str]
    providedName: str
    providedRoom: str
    providedType: str
    providerId: str
    room: str
    type: str
    def listen(self, event: str | EventListenerOptions, callback: EventListener) -> EventListenerRegister:
        pass

    async def probe(self) -> bool:
        pass

    async def setMixins(self, mixins: list[str]) -> None:
        pass

    async def setName(self, name: str) -> None:
        pass

    async def setRoom(self, room: str) -> None:
        pass

    async def setType(self, type: ScryptedDeviceType) -> None:
        pass


class ScryptedDeviceCreator:


    pass

class ScryptedPlugin:

    async def getPluginJson(self) -> Any:
        pass


class ScryptedPluginRuntime:

    scryptedRuntimeArguments: ScryptedRuntimeArguments

class ScryptedSettings:


    pass

class ScryptedSystemDevice:
    """SystemDevices are listed in the Scrypted UI."""

    systemDevice: ScryptedSystemDeviceInfo  # Type of device that will be created by this DeviceCreator. For example: Example Corp Camera or ACME Light Switch.

class ScryptedUser:
    """ScryptedUser represents a user managed by Scrypted. This interface can not be implemented, only extended by Mixins."""

    async def getScryptedUserAccessControl(self) -> ScryptedUserAccessControl:
        pass


class SecuritySystem:

    securitySystemState: SecuritySystemState
    async def armSecuritySystem(self, mode: SecuritySystemMode) -> None:
        pass

    async def disarmSecuritySystem(self) -> None:
        pass


class Sensors:

    sensors: Mapping[str, Sensor]

class Settings:
    """Settings viewing and editing of device configurations that describe or modify behavior."""

    async def getSettings(self) -> list[Setting]:
        pass

    async def putSetting(self, key: str, value: SettingValue) -> None:
        pass


class Sleep:

    sleeping: bool

class StartStop:
    """StartStop represents a device that can be started, stopped, and possibly paused and resumed. Typically vacuum cleaners or washers."""

    running: bool
    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass


class StreamService:
    """Generic bidirectional stream connection."""

    async def connectStream(self, input: AsyncGenerator[Any, None] = None, options: Any = None) -> AsyncGenerator[Any, None]:
        pass


class TamperSensor:

    tampered: TamperState

class TemperatureSetting:
    """TemperatureSetting represents a thermostat device."""

    temperatureSetting: TemperatureSettingStatus
    async def setTemperature(self, command: TemperatureCommand) -> None:
        pass


class Thermometer:

    temperature: float  # Get the ambient temperature in Celsius.
    temperatureUnit: TemperatureUnit  # Get the user facing unit of measurement for this thermometer, if any. Note that while this may be Fahrenheit, getTemperatureAmbient will return the temperature in Celsius.
    async def setTemperatureUnit(self, temperatureUnit: TemperatureUnit) -> None:
        pass


class TTY:
    """TTY connection offered by a remote device that can be connected to by an interactive terminal interface.  Implementors should also implement StreamService to handle the actual data transfer."""


    pass

class TTYSettings:
    """TTYSettings allows TTY backends to query plugins for modifications to the (non-)interactive terminal environment."""

    async def getTTYSettings(self) -> Any:
        pass


class UltravioletSensor:

    ultraviolet: float

class VideoCamera:
    """VideoCamera devices can capture video streams."""

    async def getVideoStream(self, options: RequestMediaStreamOptions = None) -> MediaObject:
        pass

    async def getVideoStreamOptions(self) -> list[ResponseMediaStreamOptions]:
        pass


class VideoCameraConfiguration:

    async def setVideoStreamOptions(self, options: MediaStreamOptions) -> MediaStreamConfiguration:
        pass


class VideoCameraMask:

    async def getPrivacyMasks(self) -> PrivacyMasks:
        pass

    async def setPrivacyMasks(self, masks: PrivacyMasks) -> None:
        pass


class VideoClips:

    async def getVideoClip(self, videoId: str) -> MediaObject:
        pass

    async def getVideoClips(self, options: VideoClipOptions = None) -> list[VideoClip]:
        pass

    async def getVideoClipThumbnail(self, thumbnailId: str, options: VideoClipThumbnailOptions = None) -> MediaObject:
        pass

    async def removeVideoClips(self, videoClipIds: list[str]) -> None:
        pass


class VideoFrameGenerator:

    async def generateVideoFrames(self, mediaObject: MediaObject, options: VideoFrameGeneratorOptions = None) -> AsyncGenerator[VideoFrame, None]:
        pass


class VideoRecorder:

    recordingActive: bool
    async def getRecordingStream(self, options: RequestRecordingStreamOptions, recordingStream: MediaObject = None) -> MediaObject:
        pass

    async def getRecordingStreamCurrentTime(self, recordingStream: MediaObject) -> float:
        pass

    async def getRecordingStreamOptions(self) -> list[ResponseMediaStreamOptions]:
        pass

    async def getRecordingStreamThumbnail(self, time: float, options: RecordingStreamThumbnailOptions = None) -> MediaObject:
        pass


class VideoRecorderManagement:

    async def deleteRecordingStream(self, options: DeleteRecordingStreamOptions) -> None:
        pass

    async def setRecordingActive(self, recordingActive: bool) -> None:
        pass


class VideoTextOverlays:

    async def getVideoTextOverlays(self) -> Mapping[str, VideoTextOverlay]:
        pass

    async def setVideoTextOverlay(self, id: str, value: VideoTextOverlay) -> None:
        pass


class VOCSensor:

    vocDensity: float

class Logger:
    """Logger is exposed via log.* to allow writing to the Scrypted log."""

    def a(self, msg: str) -> None:
        pass

    def clear(self) -> None:
        pass

    def clearAlert(self, msg: str) -> None:
        pass

    def clearAlerts(self) -> None:
        pass

    def d(self, msg: str) -> None:
        pass

    def e(self, msg: str) -> None:
        pass

    def i(self, msg: str) -> None:
        pass

    def v(self, msg: str) -> None:
        pass

    def w(self, msg: str) -> None:
        pass


class DeviceManager:
    """DeviceManager is the interface used by DeviceProvider to report new devices, device states, and device events to Scrypted."""

    def createDeviceState(self, id: str, setState: Any) -> WritableDeviceState:
        pass

    def getDeviceConsole(self, nativeId: str = None) -> Console:
        pass

    def getDeviceLogger(self, nativeId: str = None) -> Logger:
        pass

    def getDeviceState(self, nativeId: str = None) -> DeviceState:
        pass

    def getDeviceStorage(self, nativeId: str = None) -> Storage:
        pass

    def getMixinConsole(self, mixinId: str, nativeId: str = None) -> Console:
        pass

    def getMixinStorage(self, id: str, nativeId: str = None) -> Storage:
        pass

    def getNativeIds(self) -> list[str]:
        pass

    async def onDeviceDiscovered(self, device: Device) -> str:
        pass

    async def onDeviceEvent(self, nativeId: str, eventInterface: str, eventData: Any) -> None:
        pass

    async def onDeviceRemoved(self, nativeId: str) -> None:
        pass

    async def onDevicesChanged(self, devices: DeviceManifest) -> None:
        pass

    async def onMixinEvent(self, id: str, mixinDevice: Any, eventInterface: str, eventData: Any) -> None:
        pass

    async def requestRestart(self) -> None:
        pass


class SystemManager:
    """SystemManager is used by scripts to query device state and access devices."""

    async def getComponent(self, id: str) -> Any:
        pass

    def getDeviceById(self, id: str) -> ScryptedDevice:
        pass

    def getDeviceByName(self, name: str) -> ScryptedDevice:
        pass

    def getSystemState(self) -> Any:
        pass

    def listen(self, callback: EventListener) -> EventListenerRegister:
        pass

    def listenDevice(self, id: str, event: str | EventListenerOptions, callback: EventListener) -> EventListenerRegister:
        pass

    async def removeDevice(self, id: str) -> None:
        pass


class MediaManager:

    async def convertMediaObject(self, mediaObject: MediaObject, toMimeType: str) -> Any:
        pass

    async def convertMediaObjectToBuffer(self, mediaObject: MediaObject, toMimeType: str) -> bytearray:
        pass

    async def convertMediaObjectToInsecureLocalUrl(self, mediaObject: str | MediaObject, toMimeType: str) -> str:
        pass

    async def convertMediaObjectToJSON(self, mediaObject: MediaObject, toMimeType: str) -> Any:
        pass

    async def convertMediaObjectToLocalUrl(self, mediaObject: str | MediaObject, toMimeType: str) -> str:
        pass

    async def convertMediaObjectToUrl(self, mediaObject: str | MediaObject, toMimeType: str) -> str:
        pass

    async def createFFmpegMediaObject(self, ffmpegInput: FFmpegInput, options: Any = None) -> Union[MediaObject, Any]:
        pass

    async def createMediaObject(self, data: Any, mimeType: str, options: Any = None) -> Union[MediaObject, Any]:
        pass

    async def createMediaObjectFromUrl(self, data: str, options: Any = None) -> Union[MediaObject, Any]:
        pass

    async def getFFmpegPath(self) -> str:
        pass

    async def getFilesPath(self) -> str:
        pass


class EndpointManager:
    """EndpointManager provides publicly accessible URLs that can be used to contact your Scrypted Plugin."""

    async def getAuthenticatedPath(self, nativeId: str = None) -> str:
        pass

    async def getCloudEndpoint(self, nativeId: str = None, options: Any = None) -> str:
        pass

    async def getCloudPushEndpoint(self, nativeId: str = None) -> str:
        pass

    async def getInsecurePublicLocalEndpoint(self, nativeId: str = None) -> str:
        pass

    async def getLocalAddresses(self) -> list[str]:
        pass

    async def getLocalEndpoint(self, nativeId: str = None, options: Any = None) -> str:
        pass

    async def getPath(self, nativeId: str = None, options: Any = None) -> str:
        pass

    async def getPublicCloudEndpoint(self, nativeId: str = None) -> str:
        pass

    async def getPublicLocalEndpoint(self, nativeId: str = None) -> str:
        pass

    async def getPublicPushEndpoint(self, nativeId: str = None) -> str:
        pass

    async def setAccessControlAllowOrigin(self, options: EndpointAccessControlAllowOrigin) -> None:
        pass

    async def setLocalAddresses(self, addresses: list[str]) -> None:
        pass


class ClusterManager:

    def getClusterAddress(self) -> str:
        pass

    def getClusterMode(self) -> Any | Any:
        pass

    def getClusterWorkerId(self) -> str:
        pass

    async def getClusterWorkers(self) -> Mapping[str, ClusterWorker]:
        pass


class ScryptedInterfaceProperty(str, Enum):
    id = "id"
    info = "info"
    interfaces = "interfaces"
    mixins = "mixins"
    name = "name"
    nativeId = "nativeId"
    pluginId = "pluginId"
    providedInterfaces = "providedInterfaces"
    providedName = "providedName"
    providedRoom = "providedRoom"
    providedType = "providedType"
    providerId = "providerId"
    room = "room"
    type = "type"
    scryptedRuntimeArguments = "scryptedRuntimeArguments"
    on = "on"
    brightness = "brightness"
    colorTemperature = "colorTemperature"
    rgb = "rgb"
    hsv = "hsv"
    buttons = "buttons"
    sensors = "sensors"
    running = "running"
    paused = "paused"
    docked = "docked"
    temperatureSetting = "temperatureSetting"
    temperature = "temperature"
    temperatureUnit = "temperatureUnit"
    humidity = "humidity"
    audioVolumes = "audioVolumes"
    recordingActive = "recordingActive"
    ptzCapabilities = "ptzCapabilities"
    lockState = "lockState"
    entryOpen = "entryOpen"
    batteryLevel = "batteryLevel"
    chargeState = "chargeState"
    online = "online"
    fromMimeType = "fromMimeType"
    toMimeType = "toMimeType"
    converters = "converters"
    binaryState = "binaryState"
    tampered = "tampered"
    sleeping = "sleeping"
    powerDetected = "powerDetected"
    audioDetected = "audioDetected"
    motionDetected = "motionDetected"
    ambientLight = "ambientLight"
    occupied = "occupied"
    flooded = "flooded"
    ultraviolet = "ultraviolet"
    luminance = "luminance"
    position = "position"
    securitySystemState = "securitySystemState"
    pm10Density = "pm10Density"
    pm25Density = "pm25Density"
    vocDensity = "vocDensity"
    noxDensity = "noxDensity"
    co2ppm = "co2ppm"
    airQuality = "airQuality"
    airPurifierState = "airPurifierState"
    filterChangeIndication = "filterChangeIndication"
    filterLifeLevel = "filterLifeLevel"
    humiditySetting = "humiditySetting"
    fan = "fan"
    applicationInfo = "applicationInfo"
    systemDevice = "systemDevice"

class ScryptedInterfaceMethods(str, Enum):
    listen = "listen"
    probe = "probe"
    setMixins = "setMixins"
    setName = "setName"
    setRoom = "setRoom"
    setType = "setType"
    getPluginJson = "getPluginJson"
    turnOff = "turnOff"
    turnOn = "turnOn"
    setBrightness = "setBrightness"
    getTemperatureMaxK = "getTemperatureMaxK"
    getTemperatureMinK = "getTemperatureMinK"
    setColorTemperature = "setColorTemperature"
    setRgb = "setRgb"
    setHsv = "setHsv"
    pressButton = "pressButton"
    sendNotification = "sendNotification"
    start = "start"
    stop = "stop"
    pause = "pause"
    resume = "resume"
    dock = "dock"
    setTemperature = "setTemperature"
    setTemperatureUnit = "setTemperatureUnit"
    getPictureOptions = "getPictureOptions"
    takePicture = "takePicture"
    getAudioStream = "getAudioStream"
    setAudioVolumes = "setAudioVolumes"
    startDisplay = "startDisplay"
    stopDisplay = "stopDisplay"
    getVideoStream = "getVideoStream"
    getVideoStreamOptions = "getVideoStreamOptions"
    getPrivacyMasks = "getPrivacyMasks"
    setPrivacyMasks = "setPrivacyMasks"
    getVideoTextOverlays = "getVideoTextOverlays"
    setVideoTextOverlay = "setVideoTextOverlay"
    getRecordingStream = "getRecordingStream"
    getRecordingStreamCurrentTime = "getRecordingStreamCurrentTime"
    getRecordingStreamOptions = "getRecordingStreamOptions"
    getRecordingStreamThumbnail = "getRecordingStreamThumbnail"
    deleteRecordingStream = "deleteRecordingStream"
    setRecordingActive = "setRecordingActive"
    ptzCommand = "ptzCommand"
    getRecordedEvents = "getRecordedEvents"
    getVideoClip = "getVideoClip"
    getVideoClips = "getVideoClips"
    getVideoClipThumbnail = "getVideoClipThumbnail"
    removeVideoClips = "removeVideoClips"
    setVideoStreamOptions = "setVideoStreamOptions"
    startIntercom = "startIntercom"
    stopIntercom = "stopIntercom"
    lock = "lock"
    unlock = "unlock"
    addPassword = "addPassword"
    getPasswords = "getPasswords"
    removePassword = "removePassword"
    activate = "activate"
    deactivate = "deactivate"
    isReversible = "isReversible"
    closeEntry = "closeEntry"
    openEntry = "openEntry"
    getDevice = "getDevice"
    releaseDevice = "releaseDevice"
    adoptDevice = "adoptDevice"
    discoverDevices = "discoverDevices"
    createDevice = "createDevice"
    getCreateDeviceSettings = "getCreateDeviceSettings"
    reboot = "reboot"
    getRefreshFrequency = "getRefreshFrequency"
    refresh = "refresh"
    getMediaStatus = "getMediaStatus"
    load = "load"
    seek = "seek"
    skipNext = "skipNext"
    skipPrevious = "skipPrevious"
    convert = "convert"
    convertMedia = "convertMedia"
    getSettings = "getSettings"
    putSetting = "putSetting"
    armSecuritySystem = "armSecuritySystem"
    disarmSecuritySystem = "disarmSecuritySystem"
    setAirPurifierState = "setAirPurifierState"
    getReadmeMarkdown = "getReadmeMarkdown"
    getOauthUrl = "getOauthUrl"
    onOauthCallback = "onOauthCallback"
    canMixin = "canMixin"
    getMixin = "getMixin"
    releaseMixin = "releaseMixin"
    onRequest = "onRequest"
    onConnection = "onConnection"
    onPush = "onPush"
    run = "run"
    eval = "eval"
    loadScripts = "loadScripts"
    saveScript = "saveScript"
    forkInterface = "forkInterface"
    trackObjects = "trackObjects"
    getDetectionInput = "getDetectionInput"
    getObjectTypes = "getObjectTypes"
    detectObjects = "detectObjects"
    generateObjectDetections = "generateObjectDetections"
    getDetectionModel = "getDetectionModel"
    setHumidity = "setHumidity"
    setFan = "setFan"
    startRTCSignalingSession = "startRTCSignalingSession"
    createRTCSignalingSession = "createRTCSignalingSession"
    getScryptedUserAccessControl = "getScryptedUserAccessControl"
    generateVideoFrames = "generateVideoFrames"
    connectStream = "connectStream"
    getTTYSettings = "getTTYSettings"

class DeviceState:

    def getScryptedProperty(self, property: str) -> Any:
        pass

    def setScryptedProperty(self, property: str, value: Any):
        pass


    @property
    def id(self) -> str:
        return self.getScryptedProperty("id")

    @id.setter
    def id(self, value: str):
        self.setScryptedProperty("id", value)

    @property
    def info(self) -> DeviceInformation:
        return self.getScryptedProperty("info")

    @info.setter
    def info(self, value: DeviceInformation):
        self.setScryptedProperty("info", value)

    @property
    def interfaces(self) -> list[str]:
        return self.getScryptedProperty("interfaces")

    @interfaces.setter
    def interfaces(self, value: list[str]):
        self.setScryptedProperty("interfaces", value)

    @property
    def mixins(self) -> list[str]:
        return self.getScryptedProperty("mixins")

    @mixins.setter
    def mixins(self, value: list[str]):
        self.setScryptedProperty("mixins", value)

    @property
    def name(self) -> str:
        return self.getScryptedProperty("name")

    @name.setter
    def name(self, value: str):
        self.setScryptedProperty("name", value)

    @property
    def pluginId(self) -> str:
        return self.getScryptedProperty("pluginId")

    @pluginId.setter
    def pluginId(self, value: str):
        self.setScryptedProperty("pluginId", value)

    @property
    def providedInterfaces(self) -> list[str]:
        return self.getScryptedProperty("providedInterfaces")

    @providedInterfaces.setter
    def providedInterfaces(self, value: list[str]):
        self.setScryptedProperty("providedInterfaces", value)

    @property
    def providedName(self) -> str:
        return self.getScryptedProperty("providedName")

    @providedName.setter
    def providedName(self, value: str):
        self.setScryptedProperty("providedName", value)

    @property
    def providedRoom(self) -> str:
        return self.getScryptedProperty("providedRoom")

    @providedRoom.setter
    def providedRoom(self, value: str):
        self.setScryptedProperty("providedRoom", value)

    @property
    def providedType(self) -> str:
        return self.getScryptedProperty("providedType")

    @providedType.setter
    def providedType(self, value: str):
        self.setScryptedProperty("providedType", value)

    @property
    def providerId(self) -> str:
        return self.getScryptedProperty("providerId")

    @providerId.setter
    def providerId(self, value: str):
        self.setScryptedProperty("providerId", value)

    @property
    def room(self) -> str:
        return self.getScryptedProperty("room")

    @room.setter
    def room(self, value: str):
        self.setScryptedProperty("room", value)

    @property
    def type(self) -> str:
        return self.getScryptedProperty("type")

    @type.setter
    def type(self, value: str):
        self.setScryptedProperty("type", value)

    @property
    def scryptedRuntimeArguments(self) -> ScryptedRuntimeArguments:
        return self.getScryptedProperty("scryptedRuntimeArguments")

    @scryptedRuntimeArguments.setter
    def scryptedRuntimeArguments(self, value: ScryptedRuntimeArguments):
        self.setScryptedProperty("scryptedRuntimeArguments", value)

    @property
    def on(self) -> bool:
        return self.getScryptedProperty("on")

    @on.setter
    def on(self, value: bool):
        self.setScryptedProperty("on", value)

    @property
    def brightness(self) -> float:
        return self.getScryptedProperty("brightness")

    @brightness.setter
    def brightness(self, value: float):
        self.setScryptedProperty("brightness", value)

    @property
    def colorTemperature(self) -> float:
        return self.getScryptedProperty("colorTemperature")

    @colorTemperature.setter
    def colorTemperature(self, value: float):
        self.setScryptedProperty("colorTemperature", value)

    @property
    def rgb(self) -> ColorRgb:
        return self.getScryptedProperty("rgb")

    @rgb.setter
    def rgb(self, value: ColorRgb):
        self.setScryptedProperty("rgb", value)

    @property
    def hsv(self) -> ColorHsv:
        return self.getScryptedProperty("hsv")

    @hsv.setter
    def hsv(self, value: ColorHsv):
        self.setScryptedProperty("hsv", value)

    @property
    def buttons(self) -> list[str]:
        return self.getScryptedProperty("buttons")

    @buttons.setter
    def buttons(self, value: list[str]):
        self.setScryptedProperty("buttons", value)

    @property
    def sensors(self) -> Mapping[str, Sensor]:
        return self.getScryptedProperty("sensors")

    @sensors.setter
    def sensors(self, value: Mapping[str, Sensor]):
        self.setScryptedProperty("sensors", value)

    @property
    def running(self) -> bool:
        return self.getScryptedProperty("running")

    @running.setter
    def running(self, value: bool):
        self.setScryptedProperty("running", value)

    @property
    def paused(self) -> bool:
        return self.getScryptedProperty("paused")

    @paused.setter
    def paused(self, value: bool):
        self.setScryptedProperty("paused", value)

    @property
    def docked(self) -> bool:
        return self.getScryptedProperty("docked")

    @docked.setter
    def docked(self, value: bool):
        self.setScryptedProperty("docked", value)

    @property
    def temperatureSetting(self) -> TemperatureSettingStatus:
        return self.getScryptedProperty("temperatureSetting")

    @temperatureSetting.setter
    def temperatureSetting(self, value: TemperatureSettingStatus):
        self.setScryptedProperty("temperatureSetting", value)

    @property
    def temperature(self) -> float:
        return self.getScryptedProperty("temperature")

    @temperature.setter
    def temperature(self, value: float):
        self.setScryptedProperty("temperature", value)

    @property
    def temperatureUnit(self) -> TemperatureUnit:
        return self.getScryptedProperty("temperatureUnit")

    @temperatureUnit.setter
    def temperatureUnit(self, value: TemperatureUnit):
        self.setScryptedProperty("temperatureUnit", value)

    @property
    def humidity(self) -> float:
        return self.getScryptedProperty("humidity")

    @humidity.setter
    def humidity(self, value: float):
        self.setScryptedProperty("humidity", value)

    @property
    def audioVolumes(self) -> AudioVolumes:
        return self.getScryptedProperty("audioVolumes")

    @audioVolumes.setter
    def audioVolumes(self, value: AudioVolumes):
        self.setScryptedProperty("audioVolumes", value)

    @property
    def recordingActive(self) -> bool:
        return self.getScryptedProperty("recordingActive")

    @recordingActive.setter
    def recordingActive(self, value: bool):
        self.setScryptedProperty("recordingActive", value)

    @property
    def ptzCapabilities(self) -> PanTiltZoomCapabilities:
        return self.getScryptedProperty("ptzCapabilities")

    @ptzCapabilities.setter
    def ptzCapabilities(self, value: PanTiltZoomCapabilities):
        self.setScryptedProperty("ptzCapabilities", value)

    @property
    def lockState(self) -> LockState:
        return self.getScryptedProperty("lockState")

    @lockState.setter
    def lockState(self, value: LockState):
        self.setScryptedProperty("lockState", value)

    @property
    def entryOpen(self) -> bool | Any:
        return self.getScryptedProperty("entryOpen")

    @entryOpen.setter
    def entryOpen(self, value: bool | Any):
        self.setScryptedProperty("entryOpen", value)

    @property
    def batteryLevel(self) -> float:
        return self.getScryptedProperty("batteryLevel")

    @batteryLevel.setter
    def batteryLevel(self, value: float):
        self.setScryptedProperty("batteryLevel", value)

    @property
    def chargeState(self) -> ChargeState:
        return self.getScryptedProperty("chargeState")

    @chargeState.setter
    def chargeState(self, value: ChargeState):
        self.setScryptedProperty("chargeState", value)

    @property
    def online(self) -> bool:
        return self.getScryptedProperty("online")

    @online.setter
    def online(self, value: bool):
        self.setScryptedProperty("online", value)

    @property
    def fromMimeType(self) -> str:
        return self.getScryptedProperty("fromMimeType")

    @fromMimeType.setter
    def fromMimeType(self, value: str):
        self.setScryptedProperty("fromMimeType", value)

    @property
    def toMimeType(self) -> str:
        return self.getScryptedProperty("toMimeType")

    @toMimeType.setter
    def toMimeType(self, value: str):
        self.setScryptedProperty("toMimeType", value)

    @property
    def converters(self) -> list[MediaConverterTypes]:
        return self.getScryptedProperty("converters")

    @converters.setter
    def converters(self, value: list[MediaConverterTypes]):
        self.setScryptedProperty("converters", value)

    @property
    def binaryState(self) -> bool:
        return self.getScryptedProperty("binaryState")

    @binaryState.setter
    def binaryState(self, value: bool):
        self.setScryptedProperty("binaryState", value)

    @property
    def tampered(self) -> TamperState:
        return self.getScryptedProperty("tampered")

    @tampered.setter
    def tampered(self, value: TamperState):
        self.setScryptedProperty("tampered", value)

    @property
    def sleeping(self) -> bool:
        return self.getScryptedProperty("sleeping")

    @sleeping.setter
    def sleeping(self, value: bool):
        self.setScryptedProperty("sleeping", value)

    @property
    def powerDetected(self) -> bool:
        return self.getScryptedProperty("powerDetected")

    @powerDetected.setter
    def powerDetected(self, value: bool):
        self.setScryptedProperty("powerDetected", value)

    @property
    def audioDetected(self) -> bool:
        return self.getScryptedProperty("audioDetected")

    @audioDetected.setter
    def audioDetected(self, value: bool):
        self.setScryptedProperty("audioDetected", value)

    @property
    def motionDetected(self) -> bool:
        return self.getScryptedProperty("motionDetected")

    @motionDetected.setter
    def motionDetected(self, value: bool):
        self.setScryptedProperty("motionDetected", value)

    @property
    def ambientLight(self) -> float:
        return self.getScryptedProperty("ambientLight")

    @ambientLight.setter
    def ambientLight(self, value: float):
        self.setScryptedProperty("ambientLight", value)

    @property
    def occupied(self) -> bool:
        return self.getScryptedProperty("occupied")

    @occupied.setter
    def occupied(self, value: bool):
        self.setScryptedProperty("occupied", value)

    @property
    def flooded(self) -> bool:
        return self.getScryptedProperty("flooded")

    @flooded.setter
    def flooded(self, value: bool):
        self.setScryptedProperty("flooded", value)

    @property
    def ultraviolet(self) -> float:
        return self.getScryptedProperty("ultraviolet")

    @ultraviolet.setter
    def ultraviolet(self, value: float):
        self.setScryptedProperty("ultraviolet", value)

    @property
    def luminance(self) -> float:
        return self.getScryptedProperty("luminance")

    @luminance.setter
    def luminance(self, value: float):
        self.setScryptedProperty("luminance", value)

    @property
    def position(self) -> Position:
        return self.getScryptedProperty("position")

    @position.setter
    def position(self, value: Position):
        self.setScryptedProperty("position", value)

    @property
    def securitySystemState(self) -> SecuritySystemState:
        return self.getScryptedProperty("securitySystemState")

    @securitySystemState.setter
    def securitySystemState(self, value: SecuritySystemState):
        self.setScryptedProperty("securitySystemState", value)

    @property
    def pm10Density(self) -> float:
        return self.getScryptedProperty("pm10Density")

    @pm10Density.setter
    def pm10Density(self, value: float):
        self.setScryptedProperty("pm10Density", value)

    @property
    def pm25Density(self) -> float:
        return self.getScryptedProperty("pm25Density")

    @pm25Density.setter
    def pm25Density(self, value: float):
        self.setScryptedProperty("pm25Density", value)

    @property
    def vocDensity(self) -> float:
        return self.getScryptedProperty("vocDensity")

    @vocDensity.setter
    def vocDensity(self, value: float):
        self.setScryptedProperty("vocDensity", value)

    @property
    def noxDensity(self) -> float:
        return self.getScryptedProperty("noxDensity")

    @noxDensity.setter
    def noxDensity(self, value: float):
        self.setScryptedProperty("noxDensity", value)

    @property
    def co2ppm(self) -> float:
        return self.getScryptedProperty("co2ppm")

    @co2ppm.setter
    def co2ppm(self, value: float):
        self.setScryptedProperty("co2ppm", value)

    @property
    def airQuality(self) -> AirQuality:
        return self.getScryptedProperty("airQuality")

    @airQuality.setter
    def airQuality(self, value: AirQuality):
        self.setScryptedProperty("airQuality", value)

    @property
    def airPurifierState(self) -> AirPurifierState:
        return self.getScryptedProperty("airPurifierState")

    @airPurifierState.setter
    def airPurifierState(self, value: AirPurifierState):
        self.setScryptedProperty("airPurifierState", value)

    @property
    def filterChangeIndication(self) -> bool:
        return self.getScryptedProperty("filterChangeIndication")

    @filterChangeIndication.setter
    def filterChangeIndication(self, value: bool):
        self.setScryptedProperty("filterChangeIndication", value)

    @property
    def filterLifeLevel(self) -> float:
        return self.getScryptedProperty("filterLifeLevel")

    @filterLifeLevel.setter
    def filterLifeLevel(self, value: float):
        self.setScryptedProperty("filterLifeLevel", value)

    @property
    def humiditySetting(self) -> HumiditySettingStatus:
        return self.getScryptedProperty("humiditySetting")

    @humiditySetting.setter
    def humiditySetting(self, value: HumiditySettingStatus):
        self.setScryptedProperty("humiditySetting", value)

    @property
    def fan(self) -> FanStatus:
        return self.getScryptedProperty("fan")

    @fan.setter
    def fan(self, value: FanStatus):
        self.setScryptedProperty("fan", value)

    @property
    def applicationInfo(self) -> LauncherApplicationInfo:
        return self.getScryptedProperty("applicationInfo")

    @applicationInfo.setter
    def applicationInfo(self, value: LauncherApplicationInfo):
        self.setScryptedProperty("applicationInfo", value)

    @property
    def systemDevice(self) -> ScryptedSystemDeviceInfo:
        return self.getScryptedProperty("systemDevice")

    @systemDevice.setter
    def systemDevice(self, value: ScryptedSystemDeviceInfo):
        self.setScryptedProperty("systemDevice", value)

ScryptedInterfaceDescriptors = {
  "ScryptedDevice": {
    "name": "ScryptedDevice",
    "methods": [
      "listen",
      "probe",
      "setMixins",
      "setName",
      "setRoom",
      "setType"
    ],
    "properties": [
      "id",
      "info",
      "interfaces",
      "mixins",
      "name",
      "nativeId",
      "pluginId",
      "providedInterfaces",
      "providedName",
      "providedRoom",
      "providedType",
      "providerId",
      "room",
      "type"
    ]
  },
  "ScryptedPlugin": {
    "name": "ScryptedPlugin",
    "methods": [
      "getPluginJson"
    ],
    "properties": []
  },
  "ScryptedPluginRuntime": {
    "name": "ScryptedPluginRuntime",
    "methods": [],
    "properties": [
      "scryptedRuntimeArguments"
    ]
  },
  "OnOff": {
    "name": "OnOff",
    "methods": [
      "turnOff",
      "turnOn"
    ],
    "properties": [
      "on"
    ]
  },
  "Brightness": {
    "name": "Brightness",
    "methods": [
      "setBrightness"
    ],
    "properties": [
      "brightness"
    ]
  },
  "ColorSettingTemperature": {
    "name": "ColorSettingTemperature",
    "methods": [
      "getTemperatureMaxK",
      "getTemperatureMinK",
      "setColorTemperature"
    ],
    "properties": [
      "colorTemperature"
    ]
  },
  "ColorSettingRgb": {
    "name": "ColorSettingRgb",
    "methods": [
      "setRgb"
    ],
    "properties": [
      "rgb"
    ]
  },
  "ColorSettingHsv": {
    "name": "ColorSettingHsv",
    "methods": [
      "setHsv"
    ],
    "properties": [
      "hsv"
    ]
  },
  "Buttons": {
    "name": "Buttons",
    "methods": [],
    "properties": [
      "buttons"
    ]
  },
  "PressButtons": {
    "name": "PressButtons",
    "methods": [
      "pressButton"
    ],
    "properties": []
  },
  "Sensors": {
    "name": "Sensors",
    "methods": [],
    "properties": [
      "sensors"
    ]
  },
  "Notifier": {
    "name": "Notifier",
    "methods": [
      "sendNotification"
    ],
    "properties": []
  },
  "StartStop": {
    "name": "StartStop",
    "methods": [
      "start",
      "stop"
    ],
    "properties": [
      "running"
    ]
  },
  "Pause": {
    "name": "Pause",
    "methods": [
      "pause",
      "resume"
    ],
    "properties": [
      "paused"
    ]
  },
  "Dock": {
    "name": "Dock",
    "methods": [
      "dock"
    ],
    "properties": [
      "docked"
    ]
  },
  "TemperatureSetting": {
    "name": "TemperatureSetting",
    "methods": [
      "setTemperature"
    ],
    "properties": [
      "temperatureSetting"
    ]
  },
  "Thermometer": {
    "name": "Thermometer",
    "methods": [
      "setTemperatureUnit"
    ],
    "properties": [
      "temperature",
      "temperatureUnit"
    ]
  },
  "HumiditySensor": {
    "name": "HumiditySensor",
    "methods": [],
    "properties": [
      "humidity"
    ]
  },
  "Camera": {
    "name": "Camera",
    "methods": [
      "getPictureOptions",
      "takePicture"
    ],
    "properties": []
  },
  "Microphone": {
    "name": "Microphone",
    "methods": [
      "getAudioStream"
    ],
    "properties": []
  },
  "AudioVolumeControl": {
    "name": "AudioVolumeControl",
    "methods": [
      "setAudioVolumes"
    ],
    "properties": [
      "audioVolumes"
    ]
  },
  "Display": {
    "name": "Display",
    "methods": [
      "startDisplay",
      "stopDisplay"
    ],
    "properties": []
  },
  "VideoCamera": {
    "name": "VideoCamera",
    "methods": [
      "getVideoStream",
      "getVideoStreamOptions"
    ],
    "properties": []
  },
  "VideoCameraMask": {
    "name": "VideoCameraMask",
    "methods": [
      "getPrivacyMasks",
      "setPrivacyMasks"
    ],
    "properties": []
  },
  "VideoTextOverlays": {
    "name": "VideoTextOverlays",
    "methods": [
      "getVideoTextOverlays",
      "setVideoTextOverlay"
    ],
    "properties": []
  },
  "VideoRecorder": {
    "name": "VideoRecorder",
    "methods": [
      "getRecordingStream",
      "getRecordingStreamCurrentTime",
      "getRecordingStreamOptions",
      "getRecordingStreamThumbnail"
    ],
    "properties": [
      "recordingActive"
    ]
  },
  "VideoRecorderManagement": {
    "name": "VideoRecorderManagement",
    "methods": [
      "deleteRecordingStream",
      "setRecordingActive"
    ],
    "properties": []
  },
  "PanTiltZoom": {
    "name": "PanTiltZoom",
    "methods": [
      "ptzCommand"
    ],
    "properties": [
      "ptzCapabilities"
    ]
  },
  "EventRecorder": {
    "name": "EventRecorder",
    "methods": [
      "getRecordedEvents"
    ],
    "properties": []
  },
  "VideoClips": {
    "name": "VideoClips",
    "methods": [
      "getVideoClip",
      "getVideoClips",
      "getVideoClipThumbnail",
      "removeVideoClips"
    ],
    "properties": []
  },
  "VideoCameraConfiguration": {
    "name": "VideoCameraConfiguration",
    "methods": [
      "setVideoStreamOptions"
    ],
    "properties": []
  },
  "Intercom": {
    "name": "Intercom",
    "methods": [
      "startIntercom",
      "stopIntercom"
    ],
    "properties": []
  },
  "Lock": {
    "name": "Lock",
    "methods": [
      "lock",
      "unlock"
    ],
    "properties": [
      "lockState"
    ]
  },
  "PasswordStore": {
    "name": "PasswordStore",
    "methods": [
      "addPassword",
      "getPasswords",
      "removePassword"
    ],
    "properties": []
  },
  "Scene": {
    "name": "Scene",
    "methods": [
      "activate",
      "deactivate",
      "isReversible"
    ],
    "properties": []
  },
  "Entry": {
    "name": "Entry",
    "methods": [
      "closeEntry",
      "openEntry"
    ],
    "properties": []
  },
  "EntrySensor": {
    "name": "EntrySensor",
    "methods": [],
    "properties": [
      "entryOpen"
    ]
  },
  "DeviceProvider": {
    "name": "DeviceProvider",
    "methods": [
      "getDevice",
      "releaseDevice"
    ],
    "properties": []
  },
  "DeviceDiscovery": {
    "name": "DeviceDiscovery",
    "methods": [
      "adoptDevice",
      "discoverDevices"
    ],
    "properties": []
  },
  "DeviceCreator": {
    "name": "DeviceCreator",
    "methods": [
      "createDevice",
      "getCreateDeviceSettings"
    ],
    "properties": []
  },
  "Battery": {
    "name": "Battery",
    "methods": [],
    "properties": [
      "batteryLevel"
    ]
  },
  "Charger": {
    "name": "Charger",
    "methods": [],
    "properties": [
      "chargeState"
    ]
  },
  "Reboot": {
    "name": "Reboot",
    "methods": [
      "reboot"
    ],
    "properties": []
  },
  "Refresh": {
    "name": "Refresh",
    "methods": [
      "getRefreshFrequency",
      "refresh"
    ],
    "properties": []
  },
  "MediaPlayer": {
    "name": "MediaPlayer",
    "methods": [
      "getMediaStatus",
      "load",
      "seek",
      "skipNext",
      "skipPrevious"
    ],
    "properties": []
  },
  "Online": {
    "name": "Online",
    "methods": [],
    "properties": [
      "online"
    ]
  },
  "BufferConverter": {
    "name": "BufferConverter",
    "methods": [
      "convert"
    ],
    "properties": [
      "fromMimeType",
      "toMimeType"
    ]
  },
  "MediaConverter": {
    "name": "MediaConverter",
    "methods": [
      "convertMedia"
    ],
    "properties": [
      "converters"
    ]
  },
  "Settings": {
    "name": "Settings",
    "methods": [
      "getSettings",
      "putSetting"
    ],
    "properties": []
  },
  "BinarySensor": {
    "name": "BinarySensor",
    "methods": [],
    "properties": [
      "binaryState"
    ]
  },
  "TamperSensor": {
    "name": "TamperSensor",
    "methods": [],
    "properties": [
      "tampered"
    ]
  },
  "Sleep": {
    "name": "Sleep",
    "methods": [],
    "properties": [
      "sleeping"
    ]
  },
  "PowerSensor": {
    "name": "PowerSensor",
    "methods": [],
    "properties": [
      "powerDetected"
    ]
  },
  "AudioSensor": {
    "name": "AudioSensor",
    "methods": [],
    "properties": [
      "audioDetected"
    ]
  },
  "MotionSensor": {
    "name": "MotionSensor",
    "methods": [],
    "properties": [
      "motionDetected"
    ]
  },
  "AmbientLightSensor": {
    "name": "AmbientLightSensor",
    "methods": [],
    "properties": [
      "ambientLight"
    ]
  },
  "OccupancySensor": {
    "name": "OccupancySensor",
    "methods": [],
    "properties": [
      "occupied"
    ]
  },
  "FloodSensor": {
    "name": "FloodSensor",
    "methods": [],
    "properties": [
      "flooded"
    ]
  },
  "UltravioletSensor": {
    "name": "UltravioletSensor",
    "methods": [],
    "properties": [
      "ultraviolet"
    ]
  },
  "LuminanceSensor": {
    "name": "LuminanceSensor",
    "methods": [],
    "properties": [
      "luminance"
    ]
  },
  "PositionSensor": {
    "name": "PositionSensor",
    "methods": [],
    "properties": [
      "position"
    ]
  },
  "SecuritySystem": {
    "name": "SecuritySystem",
    "methods": [
      "armSecuritySystem",
      "disarmSecuritySystem"
    ],
    "properties": [
      "securitySystemState"
    ]
  },
  "PM10Sensor": {
    "name": "PM10Sensor",
    "methods": [],
    "properties": [
      "pm10Density"
    ]
  },
  "PM25Sensor": {
    "name": "PM25Sensor",
    "methods": [],
    "properties": [
      "pm25Density"
    ]
  },
  "VOCSensor": {
    "name": "VOCSensor",
    "methods": [],
    "properties": [
      "vocDensity"
    ]
  },
  "NOXSensor": {
    "name": "NOXSensor",
    "methods": [],
    "properties": [
      "noxDensity"
    ]
  },
  "CO2Sensor": {
    "name": "CO2Sensor",
    "methods": [],
    "properties": [
      "co2ppm"
    ]
  },
  "AirQualitySensor": {
    "name": "AirQualitySensor",
    "methods": [],
    "properties": [
      "airQuality"
    ]
  },
  "AirPurifier": {
    "name": "AirPurifier",
    "methods": [
      "setAirPurifierState"
    ],
    "properties": [
      "airPurifierState"
    ]
  },
  "FilterMaintenance": {
    "name": "FilterMaintenance",
    "methods": [],
    "properties": [
      "filterChangeIndication",
      "filterLifeLevel"
    ]
  },
  "Readme": {
    "name": "Readme",
    "methods": [
      "getReadmeMarkdown"
    ],
    "properties": []
  },
  "OauthClient": {
    "name": "OauthClient",
    "methods": [
      "getOauthUrl",
      "onOauthCallback"
    ],
    "properties": []
  },
  "MixinProvider": {
    "name": "MixinProvider",
    "methods": [
      "canMixin",
      "getMixin",
      "releaseMixin"
    ],
    "properties": []
  },
  "HttpRequestHandler": {
    "name": "HttpRequestHandler",
    "methods": [
      "onRequest"
    ],
    "properties": []
  },
  "EngineIOHandler": {
    "name": "EngineIOHandler",
    "methods": [
      "onConnection"
    ],
    "properties": []
  },
  "PushHandler": {
    "name": "PushHandler",
    "methods": [
      "onPush"
    ],
    "properties": []
  },
  "Program": {
    "name": "Program",
    "methods": [
      "run"
    ],
    "properties": []
  },
  "Scriptable": {
    "name": "Scriptable",
    "methods": [
      "eval",
      "loadScripts",
      "saveScript"
    ],
    "properties": []
  },
  "ClusterForkInterface": {
    "name": "ClusterForkInterface",
    "methods": [
      "forkInterface"
    ],
    "properties": []
  },
  "ObjectTracker": {
    "name": "ObjectTracker",
    "methods": [
      "trackObjects"
    ],
    "properties": []
  },
  "ObjectDetector": {
    "name": "ObjectDetector",
    "methods": [
      "getDetectionInput",
      "getObjectTypes"
    ],
    "properties": []
  },
  "ObjectDetection": {
    "name": "ObjectDetection",
    "methods": [
      "detectObjects",
      "generateObjectDetections",
      "getDetectionModel"
    ],
    "properties": []
  },
  "ObjectDetectionPreview": {
    "name": "ObjectDetectionPreview",
    "methods": [],
    "properties": []
  },
  "ObjectDetectionGenerator": {
    "name": "ObjectDetectionGenerator",
    "methods": [],
    "properties": []
  },
  "HumiditySetting": {
    "name": "HumiditySetting",
    "methods": [
      "setHumidity"
    ],
    "properties": [
      "humiditySetting"
    ]
  },
  "Fan": {
    "name": "Fan",
    "methods": [
      "setFan"
    ],
    "properties": [
      "fan"
    ]
  },
  "RTCSignalingChannel": {
    "name": "RTCSignalingChannel",
    "methods": [
      "startRTCSignalingSession"
    ],
    "properties": []
  },
  "RTCSignalingClient": {
    "name": "RTCSignalingClient",
    "methods": [
      "createRTCSignalingSession"
    ],
    "properties": []
  },
  "LauncherApplication": {
    "name": "LauncherApplication",
    "methods": [],
    "properties": [
      "applicationInfo"
    ]
  },
  "ScryptedUser": {
    "name": "ScryptedUser",
    "methods": [
      "getScryptedUserAccessControl"
    ],
    "properties": []
  },
  "VideoFrameGenerator": {
    "name": "VideoFrameGenerator",
    "methods": [
      "generateVideoFrames"
    ],
    "properties": []
  },
  "StreamService": {
    "name": "StreamService",
    "methods": [
      "connectStream"
    ],
    "properties": []
  },
  "TTY": {
    "name": "TTY",
    "methods": [],
    "properties": []
  },
  "TTYSettings": {
    "name": "TTYSettings",
    "methods": [
      "getTTYSettings"
    ],
    "properties": []
  },
  "ScryptedSystemDevice": {
    "name": "ScryptedSystemDevice",
    "methods": [],
    "properties": [
      "systemDevice"
    ]
  },
  "ScryptedDeviceCreator": {
    "name": "ScryptedDeviceCreator",
    "methods": [],
    "properties": []
  },
  "ScryptedSettings": {
    "name": "ScryptedSettings",
    "methods": [],
    "properties": []
  }
}

class EventListenerRegister:
    """Returned when an event listener is attached to an EventEmitter. Call removeListener to unregister from events."""

    def removeListener(self) -> None:
        pass


class HttpResponse:
    """Response object provided by the HttpRequestHandler."""

    def send(self, body: str, options: HttpResponseOptions = None) -> None:
        pass

    def sendFile(self, path: str, options: HttpResponseOptions = None) -> None:
        pass

    def sendSocket(self, socket: Any, options: HttpResponseOptions = None) -> None:
        pass

    def sendStream(self, stream: AsyncGenerator[bytearray, None], options: HttpResponseOptions = None) -> None:
        pass


class WritableDeviceState:

    id: str
    async def setState(self, property: str, value: Any) -> None:
        pass


class Image:

    ffmpegFormats: bool
    format: str  # The in raw memory format of this image. Operations of this image may only safely request this format, or a compressed format such as jpg.
    height: float
    width: float
    async def close(self) -> None:
        pass

    async def toBuffer(self, options: ImageOptions = None) -> bytearray:
        pass

    async def toImage(self, options: ImageOptions = None) -> Union[Image, MediaObject]:
        pass


