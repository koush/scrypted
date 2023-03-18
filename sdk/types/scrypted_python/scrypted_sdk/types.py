from __future__ import annotations
from enum import Enum
from typing_extensions import TypedDict
from typing import Any
from typing import Callable

from .other import *


class AirQuality(Enum):
    Excellent = "Excellent"
    Fair = "Fair"
    Good = "Good"
    Inferior = "Inferior"
    Poor = "Poor"
    Unknown = "Unknown"

class FanMode(Enum):
    Auto = "Auto"
    Manual = "Manual"

class HumidityMode(Enum):
    Auto = "Auto"
    Dehumidify = "Dehumidify"
    Humidify = "Humidify"
    Off = "Off"

class LockState(Enum):
    Jammed = "Jammed"
    Locked = "Locked"
    Unlocked = "Unlocked"

class MediaPlayerState(Enum):
    Buffering = "Buffering"
    Idle = "Idle"
    Paused = "Paused"
    Playing = "Playing"

class PanTiltZoomMovement(Enum):
    Absolute = "Absolute"
    Relative = "Relative"

class ScryptedDeviceType(Enum):
    API = "API"
    Automation = "Automation"
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
    Irrigation = "Irrigation"
    Light = "Light"
    Lock = "Lock"
    Notifier = "Notifier"
    Outlet = "Outlet"
    PasswordControl = "PasswordControl"
    Person = "Person"
    Program = "Program"
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

class ScryptedInterface(Enum):
    AirQualitySensor = "AirQualitySensor"
    AmbientLightSensor = "AmbientLightSensor"
    AudioSensor = "AudioSensor"
    Battery = "Battery"
    BinarySensor = "BinarySensor"
    Brightness = "Brightness"
    BufferConverter = "BufferConverter"
    CO2Sensor = "CO2Sensor"
    Camera = "Camera"
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
    FloodSensor = "FloodSensor"
    HttpRequestHandler = "HttpRequestHandler"
    HumiditySensor = "HumiditySensor"
    HumiditySetting = "HumiditySetting"
    Intercom = "Intercom"
    LauncherApplication = "LauncherApplication"
    Lock = "Lock"
    LuminanceSensor = "LuminanceSensor"
    MediaPlayer = "MediaPlayer"
    Microphone = "Microphone"
    MixinProvider = "MixinProvider"
    MotionSensor = "MotionSensor"
    NOXSensor = "NOXSensor"
    Notifier = "Notifier"
    OauthClient = "OauthClient"
    ObjectDetection = "ObjectDetection"
    ObjectDetector = "ObjectDetector"
    ObjectTracker = "ObjectTracker"
    OccupancySensor = "OccupancySensor"
    OnOff = "OnOff"
    Online = "Online"
    PM10Sensor = "PM10Sensor"
    PM25Sensor = "PM25Sensor"
    PanTiltZoom = "PanTiltZoom"
    PasswordStore = "PasswordStore"
    Pause = "Pause"
    PositionSensor = "PositionSensor"
    PowerSensor = "PowerSensor"
    Program = "Program"
    PushHandler = "PushHandler"
    RTCSignalingChannel = "RTCSignalingChannel"
    RTCSignalingClient = "RTCSignalingClient"
    Readme = "Readme"
    Refresh = "Refresh"
    Scene = "Scene"
    Scriptable = "Scriptable"
    ScryptedDevice = "ScryptedDevice"
    ScryptedPlugin = "ScryptedPlugin"
    ScryptedUser = "ScryptedUser"
    SecuritySystem = "SecuritySystem"
    Settings = "Settings"
    StartStop = "StartStop"
    TamperSensor = "TamperSensor"
    TemperatureSetting = "TemperatureSetting"
    Thermometer = "Thermometer"
    UltravioletSensor = "UltravioletSensor"
    VOCSensor = "VOCSensor"
    VideoCamera = "VideoCamera"
    VideoCameraConfiguration = "VideoCameraConfiguration"
    VideoClips = "VideoClips"
    VideoFrameGenerator = "VideoFrameGenerator"
    VideoRecorder = "VideoRecorder"

class ScryptedMimeTypes(Enum):
    FFmpegInput = "x-scrypted/x-ffmpeg-input"
    FFmpegTranscodeStream = "x-scrypted/x-ffmpeg-transcode-stream"
    Image = "x-scrypted/x-scrypted-image"
    InsecureLocalUrl = "text/x-insecure-local-uri"
    LocalUrl = "text/x-local-uri"
    MediaObject = "x-scrypted/x-scrypted-media-object"
    MediaStreamFeedback = "x-scrypted/x-media-stream-feedback"
    MediaStreamUrl = "text/x-media-url"
    PushEndpoint = "text/x-push-endpoint"
    RTCConnectionManagement = "x-scrypted/x-scrypted-rtc-connection-management"
    RTCSignalingChannel = "x-scrypted/x-scrypted-rtc-signaling-channel"
    RTCSignalingSession = "x-scrypted/x-scrypted-rtc-signaling-session"
    RequestMediaObject = "x-scrypted/x-scrypted-request-media-object"
    RequestMediaStream = "x-scrypted/x-scrypted-request-stream"
    SchemePrefix = "x-scrypted/x-scrypted-scheme-"
    Url = "text/x-uri"

class SecuritySystemMode(Enum):
    AwayArmed = "AwayArmed"
    Disarmed = "Disarmed"
    HomeArmed = "HomeArmed"
    NightArmed = "NightArmed"

class SecuritySystemObstruction(Enum):
    Error = "Error"
    Occupied = "Occupied"
    Sensor = "Sensor"
    Time = "Time"

class TemperatureUnit(Enum):
    C = "C"
    F = "F"

class ThermostatMode(Enum):
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
    pass

class ObjectDetectionHistory(TypedDict):
    firstSeen: float
    lastSeen: float
    pass

class Resource(TypedDict):
    file: str
    href: str
    pass

class AudioStreamOptions(TypedDict):
    bitrate: float
    codec: str
    encoder: str
    profile: str
    pass

class HttpResponseOptions(TypedDict):
    code: float
    headers: object
    pass

class ImageOptions(TypedDict):
    crop: Any
    format: Any | Any | Any | Any
    resize: Any
    pass

class ObjectDetectionResult(TypedDict):
    boundingBox: tuple[float, float, float, float]
    className: str
    history: ObjectDetectionHistory
    id: str
    name: str
    resources: VideoResource
    score: float
    zoneHistory: Any
    zones: list[str]
    pass

class PictureDimensions(TypedDict):
    height: float
    width: float
    pass

class ScryptedDeviceAccessControl(TypedDict):
    id: str
    interfaces: list[str]
    methods: list[str]
    properties: list[str]
    pass

class VideoResource(TypedDict):
    thumbnail: Resource
    video: Resource
    pass

class VideoStreamOptions(TypedDict):
    bitrate: float
    bitrateControl: Any | Any
    codec: str
    fps: float
    h264Info: H264Info
    height: float
    idrIntervalMillis: float
    keyframeInterval: float
    maxBitrate: float
    minBitrate: float
    profile: str
    width: float
    pass

class MediaStreamDestination(TypedDict):
    pass

class MediaStreamSource(TypedDict):
    pass

class MediaStreamTool(TypedDict):
    pass

class AdoptDevice(TypedDict):
    nativeId: str
    settings: DeviceCreatorSettings
    pass

class ColorHsv(TypedDict):
    h: float
    s: float
    v: float
    pass

class ColorRgb(TypedDict):
    b: float
    g: float
    r: float
    pass

class Device(TypedDict):
    info: DeviceInformation
    interfaces: list[str]
    name: str
    nativeId: str
    providerNativeId: str
    room: str
    type: ScryptedDeviceType
    pass

class DeviceCreatorSettings(TypedDict):
    pass

class DeviceInformation(TypedDict):
    firmware: str
    ip: str
    mac: str
    managementUrl: str
    manufacturer: str
    metadata: Any
    model: str
    serialNumber: str
    version: str
    pass

class DeviceManifest(TypedDict):
    devices: list[Device]
    providerNativeId: str
    pass

class DiscoveredDevice(TypedDict):
    description: str
    info: DeviceInformation
    interfaces: list[str]
    name: str
    nativeId: str
    settings: list[Setting]
    type: ScryptedDeviceType
    pass

class EndpointAccessControlAllowOrigin(TypedDict):
    nativeId: str
    origins: list[str]
    pass

class EventDetails(TypedDict):
    eventId: str
    eventInterface: str
    eventTime: float
    mixinId: str
    property: str
    pass

class EventListenerOptions(TypedDict):
    denoise: bool
    event: str
    mixinId: str
    watch: bool
    pass

class FFmpegInput(TypedDict):
    container: str
    destinationVideoBitrate: float
    h264EncoderArguments: list[str]
    h264FilterArguments: list[str]
    inputArguments: list[str]
    mediaStreamOptions: ResponseMediaStreamOptions
    url: str
    urls: list[str]
    videoDecoderArguments: list[str]
    pass

class FanState(TypedDict):
    counterClockwise: bool
    mode: FanMode
    speed: float
    swing: bool
    pass

class FanStatus(TypedDict):
    active: bool
    availableModes: list[FanMode]
    counterClockwise: bool
    maxSpeed: float
    mode: FanMode
    speed: float
    swing: bool
    pass

class HttpRequest(TypedDict):
    aclId: str
    body: str
    headers: Any
    isPublicEndpoint: bool
    method: str
    rootPath: str
    url: str
    username: str
    pass

class HumidityCommand(TypedDict):
    dehumidifierSetpoint: float
    humidifierSetpoint: float
    mode: HumidityMode
    pass

class HumiditySettingStatus(TypedDict):
    activeMode: HumidityMode
    availableModes: list[HumidityMode]
    dehumidifierSetpoint: float
    humidifierSetpoint: float
    mode: HumidityMode
    pass

class LauncherApplicationInfo(TypedDict):
    description: str
    href: str
    icon: str
    name: str
    pass

class MediaObjectOptions(TypedDict):
    sourceId: str
    pass

class MediaPlayerOptions(TypedDict):
    autoplay: bool
    mimeType: str
    title: str
    pass

class MediaStatus(TypedDict):
    duration: float
    mediaPlayerState: MediaPlayerState
    metadata: Any
    position: float
    pass

class MediaStreamOptions(TypedDict):
    audio: AudioStreamOptions
    container: str
    id: str
    metadata: Any
    name: str
    prebuffer: float
    prebufferBytes: float
    tool: MediaStreamTool
    video: VideoStreamOptions
    pass

class NotifierOptions(TypedDict):
    actions: list[NotificationAction]
    badge: str
    body: str
    bodyWithSubtitle: str
    data: Any
    dir: NotificationDirection
    lang: str
    renotify: bool
    requireInteraction: bool
    silent: bool
    subtitle: str
    tag: str
    timestamp: float
    vibrate: VibratePattern
    pass

class ObjectDetectionGeneratorResult(TypedDict):
    __json_copy_serialize_children: Any
    detected: ObjectsDetected
    videoFrame: VideoFrame
    pass

class ObjectDetectionGeneratorSession(TypedDict):
    settings: Any
    pass

class ObjectDetectionModel(TypedDict):
    classes: list[str]
    inputFormat: Any | Any | Any
    inputSize: list[float]
    name: str
    settings: list[Setting]
    triggerClasses: list[str]
    pass

class ObjectDetectionSession(TypedDict):
    detectionId: str
    duration: float
    settings: Any
    pass

class ObjectDetectionTypes(TypedDict):
    classes: list[str]
    pass

class ObjectsDetected(TypedDict):
    detectionId: str
    detections: list[ObjectDetectionResult]
    eventId: Any
    inputDimensions: tuple[float, float]
    resources: VideoResource
    running: bool
    timestamp: float
    pass

class PanTiltZoomCapabilities(TypedDict):
    pan: bool
    tilt: bool
    zoom: bool
    pass

class PanTiltZoomCommand(TypedDict):
    movement: PanTiltZoomMovement
    pan: float
    speed: Any
    tilt: float
    zoom: float
    pass

class Position(TypedDict):
    accuracyRadius: float
    latitude: float
    longitude: float
    pass

class RecordedEvent(TypedDict):
    data: Any
    details: EventDetails
    pass

class RecordedEventOptions(TypedDict):
    count: float
    endTime: float
    reverseOrder: bool
    startId: str
    startTime: float
    pass

class RecordingStreamThumbnailOptions(TypedDict):
    crop: Any
    detectionId: str
    resize: Any
    pass

class RequestMediaStreamOptions(TypedDict):
    adaptive: bool
    audio: AudioStreamOptions
    container: str
    destination: MediaStreamDestination
    destinationId: str
    id: str
    metadata: Any
    name: str
    prebuffer: float
    prebufferBytes: float
    refresh: bool
    route: Any | Any | Any
    tool: MediaStreamTool
    video: VideoStreamOptions
    pass

class RequestPictureOptions(TypedDict):
    bulkRequest: bool
    id: str
    periodicRequest: bool
    picture: PictureDimensions
    reason: Any | Any
    pass

class RequestRecordingStreamOptions(TypedDict):
    adaptive: bool
    audio: AudioStreamOptions
    container: str
    destination: MediaStreamDestination
    destinationId: str
    duration: float
    id: str
    loop: bool
    metadata: Any
    name: str
    playbackRate: float
    prebuffer: float
    prebufferBytes: float
    refresh: bool
    route: Any | Any | Any
    startTime: float
    tool: MediaStreamTool
    video: VideoStreamOptions
    pass

class ResponseMediaStreamOptions(TypedDict):
    allowBatteryPrebuffer: bool
    audio: AudioStreamOptions
    container: str
    destinations: list[MediaStreamDestination]
    id: str
    metadata: Any
    name: str
    oobCodecParameters: bool
    prebuffer: float
    prebufferBytes: float
    refreshAt: float
    sdp: str
    source: MediaStreamSource
    tool: MediaStreamTool
    userConfigurable: bool
    video: VideoStreamOptions
    pass

class ResponsePictureOptions(TypedDict):
    canResize: bool
    id: str
    name: str
    picture: PictureDimensions
    staleDuration: float
    pass

class ScriptSource(TypedDict):
    language: str
    monacoEvalDefaults: str
    name: str
    script: str
    pass

class ScryptedUserAccessControl(TypedDict):
    devicesAccessControls: list[ScryptedDeviceAccessControl]
    pass

class SecuritySystemState(TypedDict):
    mode: SecuritySystemMode
    obstruction: SecuritySystemObstruction
    supportedModes: list[SecuritySystemMode]
    triggered: bool
    pass

class Setting(TypedDict):
    choices: list[str]
    combobox: bool
    description: str
    deviceFilter: str
    group: str
    key: str
    multiple: bool
    placeholder: str
    range: tuple[float, float]
    readonly: bool
    subgroup: str
    title: str
    type: Any | Any | Any | Any | Any | Any | Any | Any | Any | Any | Any
    value: SettingValue
    pass

class TemperatureCommand(TypedDict):
    mode: ThermostatMode
    setpoint: float | tuple[float, float]
    pass

class TemperatureSettingStatus(TypedDict):
    activeMode: ThermostatMode
    availableModes: list[ThermostatMode]
    mode: ThermostatMode
    setpoint: float | tuple[float, float]
    pass

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
    pass

class VideoClipOptions(TypedDict):
    count: float
    endTime: float
    reverseOrder: bool
    startId: str
    startTime: float
    pass

class VideoFrameGeneratorOptions(TypedDict):
    crop: Any
    format: Any | Any | Any | Any
    resize: Any
    pass

class TamperState(TypedDict):
    pass

class AirQualitySensor:
    airQuality: AirQuality
    pass

class AmbientLightSensor:
    ambientLight: float
    pass

class AudioSensor:
    audioDetected: bool
    pass

class Battery:
    batteryLevel: float
    pass

class BinarySensor:
    binaryState: bool
    pass

class Brightness:
    brightness: float
    async def setBrightness(self, brightness: float) -> None:
        pass
    pass

class BufferConverter:
    fromMimeType: str
    toMimeType: str
    async def convert(self, data: Any, fromMimeType: str, toMimeType: str, options: MediaObjectOptions = None) -> Any:
        pass
    pass

class CO2Sensor:
    co2ppm: float
    pass

class Camera:
    async def getPictureOptions(self) -> list[ResponsePictureOptions]:
        pass
    async def takePicture(self, options: RequestPictureOptions = None) -> MediaObject:
        pass
    pass

class ColorSettingHsv:
    hsv: ColorHsv
    async def setHsv(self, hue: float, saturation: float, value: float) -> None:
        pass
    pass

class ColorSettingRgb:
    rgb: ColorRgb
    async def setRgb(self, r: float, g: float, b: float) -> None:
        pass
    pass

class ColorSettingTemperature:
    colorTemperature: float
    async def getTemperatureMaxK(self) -> float:
        pass
    async def getTemperatureMinK(self) -> float:
        pass
    async def setColorTemperature(self, kelvin: float) -> None:
        pass
    pass

class DeviceCreator:
    async def createDevice(self, settings: DeviceCreatorSettings) -> str:
        pass
    async def getCreateDeviceSettings(self) -> list[Setting]:
        pass
    pass

class DeviceDiscovery:
    async def adoptDevice(self, device: AdoptDevice) -> str:
        pass
    async def discoverDevices(self, scan: bool = None) -> list[DiscoveredDevice]:
        pass
    pass

class DeviceProvider:
    async def getDevice(self, nativeId: str) -> Any:
        pass
    async def releaseDevice(self, id: str, nativeId: str) -> None:
        pass
    pass

class Display:
    async def startDisplay(self, media: MediaObject) -> None:
        pass
    async def stopDisplay(self) -> None:
        pass
    pass

class Dock:
    docked: bool
    async def dock(self) -> None:
        pass
    pass

class EngineIOHandler:
    async def onConnection(self, request: HttpRequest, webScoket: WebSocket) -> None:
        pass
    pass

class Entry:
    async def closeEntry(self) -> None:
        pass
    async def openEntry(self) -> None:
        pass
    pass

class EntrySensor:
    entryOpen: bool | Any
    pass

class EventRecorder:
    async def getRecordedEvents(self, options: RecordedEventOptions) -> list[RecordedEvent]:
        pass
    pass

class Fan:
    fan: FanStatus
    async def setFan(self, fan: FanState) -> None:
        pass
    pass

class FloodSensor:
    flooded: bool
    pass

class HttpRequestHandler:
    async def onRequest(self, request: HttpRequest, response: HttpResponse) -> None:
        pass
    pass

class HumiditySensor:
    humidity: float
    pass

class HumiditySetting:
    humiditySetting: HumiditySettingStatus
    async def setHumidity(self, humidity: HumidityCommand) -> None:
        pass
    pass

class Intercom:
    async def startIntercom(self, media: MediaObject) -> None:
        pass
    async def stopIntercom(self) -> None:
        pass
    pass

class LauncherApplication:
    applicationInfo: LauncherApplicationInfo
    pass

class Lock:
    lockState: LockState
    async def lock(self) -> None:
        pass
    async def unlock(self) -> None:
        pass
    pass

class LuminanceSensor:
    luminance: float
    pass

class MediaPlayer:
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
    pass

class Microphone:
    async def getAudioStream(self) -> MediaObject:
        pass
    pass

class MixinProvider:
    async def canMixin(self, type: ScryptedDeviceType, interfaces: list[str]) -> list[str]:
        pass
    async def getMixin(self, mixinDevice: Any, mixinDeviceInterfaces: list[ScryptedInterface], mixinDeviceState: DeviceState) -> Any:
        pass
    async def releaseMixin(self, id: str, mixinDevice: Any) -> None:
        pass
    pass

class MotionSensor:
    motionDetected: bool
    pass

class NOXSensor:
    noxDensity: float
    pass

class Notifier:
    async def sendNotification(self, title: str, options: NotifierOptions = None, media: str | MediaObject = None, icon: str | MediaObject = None) -> None:
        pass
    pass

class OauthClient:
    async def getOauthUrl(self) -> str:
        pass
    async def onOauthCallback(self, callbackUrl: str) -> None:
        pass
    pass

class ObjectDetection:
    async def detectObjects(self, mediaObject: MediaObject, session: ObjectDetectionSession = None, callbacks: ObjectDetectionCallbacks = None) -> ObjectsDetected:
        pass
    async def generateObjectDetections(self, videoFrames: VideoFrame, session: ObjectDetectionGeneratorSession) -> ObjectDetectionGeneratorResult:
        pass
    async def getDetectionModel(self, settings: Any = None) -> ObjectDetectionModel:
        pass
    pass

class ObjectDetector:
    async def getDetectionInput(self, detectionId: str, eventId: Any = None) -> MediaObject:
        pass
    async def getObjectTypes(self) -> ObjectDetectionTypes:
        pass
    pass

class ObjectTracker:
    async def trackObjects(self, detection: ObjectsDetected) -> ObjectsDetected:
        pass
    pass

class OccupancySensor:
    occupied: bool
    pass

class OnOff:
    on: bool
    async def turnOff(self) -> None:
        pass
    async def turnOn(self) -> None:
        pass
    pass

class Online:
    online: bool
    pass

class PM10Sensor:
    pm10Density: float
    pass

class PM25Sensor:
    pm25Density: float
    pass

class PanTiltZoom:
    ptzCapabilities: PanTiltZoomCapabilities
    async def ptzCommand(self, command: PanTiltZoomCommand) -> None:
        pass
    pass

class PasswordStore:
    async def addPassword(self, password: str) -> None:
        pass
    async def getPasswords(self) -> list[str]:
        pass
    async def removePassword(self, password: str) -> None:
        pass
    pass

class Pause:
    paused: bool
    async def pause(self) -> None:
        pass
    async def resume(self) -> None:
        pass
    pass

class PositionSensor:
    position: Position
    pass

class PowerSensor:
    powerDetected: bool
    pass

class Program:
    async def run(self, variables: Any = None) -> Any:
        pass
    pass

class PushHandler:
    async def onPush(self, request: HttpRequest) -> None:
        pass
    pass

class Readme:
    async def getReadmeMarkdown(self) -> str:
        pass
    pass

class Refresh:
    async def getRefreshFrequency(self) -> float:
        pass
    async def refresh(self, refreshInterface: str, userInitiated: bool) -> None:
        pass
    pass

class Scene:
    async def activate(self) -> None:
        pass
    async def deactivate(self) -> None:
        pass
    def isReversible(self) -> bool:
        pass
    pass

class Scriptable:
    async def eval(self, source: ScriptSource, variables: Any = None) -> Any:
        pass
    async def loadScripts(self) -> Any:
        pass
    async def saveScript(self, script: ScriptSource) -> None:
        pass
    pass

class ScryptedDevice:
    id: str
    info: DeviceInformation
    interfaces: list[str]
    mixins: list[str]
    name: str
    nativeId: str
    pluginId: str
    providedInterfaces: list[str]
    providedName: ScryptedDeviceType
    providedRoom: str
    providedType: ScryptedDeviceType
    providerId: str
    room: str
    type: ScryptedDeviceType
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
    pass

class ScryptedPlugin:
    async def getPluginJson(self) -> Any:
        pass
    pass

class ScryptedUser:
    async def getScryptedUserAccessControl(self) -> ScryptedUserAccessControl:
        pass
    pass

class SecuritySystem:
    securitySystemState: SecuritySystemState
    async def armSecuritySystem(self, mode: SecuritySystemMode) -> None:
        pass
    async def disarmSecuritySystem(self) -> None:
        pass
    pass

class Settings:
    async def getSettings(self) -> list[Setting]:
        pass
    async def putSetting(self, key: str, value: SettingValue) -> None:
        pass
    pass

class StartStop:
    running: bool
    async def start(self) -> None:
        pass
    async def stop(self) -> None:
        pass
    pass

class TamperSensor:
    tampered: TamperState
    pass

class TemperatureSetting:
    temperatureSetting: TemperatureSettingStatus
    thermostatActiveMode: ThermostatMode
    thermostatAvailableModes: list[ThermostatMode]
    thermostatMode: ThermostatMode
    thermostatSetpoint: float
    thermostatSetpointHigh: float
    thermostatSetpointLow: float
    async def setTemperature(self, command: TemperatureCommand) -> None:
        pass
    async def setThermostatMode(self, mode: ThermostatMode) -> None:
        pass
    async def setThermostatSetpoint(self, degrees: float) -> None:
        pass
    async def setThermostatSetpointHigh(self, high: float) -> None:
        pass
    async def setThermostatSetpointLow(self, low: float) -> None:
        pass
    pass

class Thermometer:
    temperature: float
    temperatureUnit: TemperatureUnit
    async def setTemperatureUnit(self, temperatureUnit: TemperatureUnit) -> None:
        pass
    pass

class UltravioletSensor:
    ultraviolet: float
    pass

class VOCSensor:
    vocDensity: float
    pass

class VideoCamera:
    async def getVideoStream(self, options: RequestMediaStreamOptions = None) -> MediaObject:
        pass
    async def getVideoStreamOptions(self) -> list[ResponseMediaStreamOptions]:
        pass
    pass

class VideoCameraConfiguration:
    async def setVideoStreamOptions(self, options: MediaStreamOptions) -> None:
        pass
    pass

class VideoClips:
    async def getVideoClip(self, videoId: str) -> MediaObject:
        pass
    async def getVideoClipThumbnail(self, thumbnailId: str) -> MediaObject:
        pass
    async def getVideoClips(self, options: VideoClipOptions = None) -> list[VideoClip]:
        pass
    async def removeVideoClips(self, videoClipIds: list[str]) -> None:
        pass
    pass

class VideoFrameGenerator:
    async def generateVideoFrames(self, mediaObject: MediaObject, options: VideoFrameGeneratorOptions = None, filter: Any = None) -> AsyncGenerator:
        pass
    pass

class VideoRecorder:
    async def getRecordingStream(self, options: RequestRecordingStreamOptions, recordingStream: MediaObject = None) -> MediaObject:
        pass
    async def getRecordingStreamCurrentTime(self, recordingStream: MediaObject) -> float:
        pass
    async def getRecordingStreamOptions(self) -> list[ResponseMediaStreamOptions]:
        pass
    async def getRecordingStreamThumbnail(self, time: float, options: RecordingStreamThumbnailOptions = None) -> MediaObject:
        pass
    pass

class Logger:
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
    pass

class DeviceManager:
    def createDeviceState(self, id: str, setState: Any) -> DeviceState:
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
    pass

class SystemManager:
    async def getComponent(self, id: str) -> Any:
        pass
    def getDeviceById(self, id: str) -> ScryptedDevice:
        pass
    def getDeviceByName(self, name: str) -> ScryptedDevice:
        pass
    def getDeviceState(self, id: str) -> Any:
        pass
    def getSystemState(self) -> Any:
        pass
    def listen(self, callback: EventListener) -> EventListenerRegister:
        pass
    def listenDevice(self, id: str, event: str | EventListenerOptions, callback: EventListener) -> EventListenerRegister:
        pass
    async def removeDevice(self, id: str) -> None:
        pass
    pass

class MediaManager:
    async def addConverter(self, converter: BufferConverter) -> None:
        pass
    async def clearConverters(self) -> None:
        pass
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
    async def createFFmpegMediaObject(self, ffmpegInput: FFmpegInput, options: MediaObjectOptions = None) -> MediaObject:
        pass
    async def createMediaObject(self, data: Any, mimeType: str, options: Any = None) -> Any:
        pass
    async def createMediaObjectFromUrl(self, data: str, options: Any = None) -> MediaObject:
        pass
    async def getFFmpegPath(self) -> str:
        pass
    async def getFilesPath(self) -> str:
        pass
    pass

class EndpointManager:
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
    pass

class ScryptedInterfaceProperty(Enum):
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
    on = "on"
    brightness = "brightness"
    colorTemperature = "colorTemperature"
    rgb = "rgb"
    hsv = "hsv"
    running = "running"
    paused = "paused"
    docked = "docked"
    temperatureSetting = "temperatureSetting"
    thermostatActiveMode = "thermostatActiveMode"
    thermostatAvailableModes = "thermostatAvailableModes"
    thermostatMode = "thermostatMode"
    thermostatSetpoint = "thermostatSetpoint"
    thermostatSetpointHigh = "thermostatSetpointHigh"
    thermostatSetpointLow = "thermostatSetpointLow"
    temperature = "temperature"
    temperatureUnit = "temperatureUnit"
    humidity = "humidity"
    ptzCapabilities = "ptzCapabilities"
    lockState = "lockState"
    entryOpen = "entryOpen"
    batteryLevel = "batteryLevel"
    online = "online"
    fromMimeType = "fromMimeType"
    toMimeType = "toMimeType"
    binaryState = "binaryState"
    tampered = "tampered"
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
    humiditySetting = "humiditySetting"
    fan = "fan"
    applicationInfo = "applicationInfo"

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
    def providedName(self) -> ScryptedDeviceType:
        return self.getScryptedProperty("providedName")
    @providedName.setter
    def providedName(self, value: ScryptedDeviceType):
        self.setScryptedProperty("providedName", value)

    @property
    def providedRoom(self) -> str:
        return self.getScryptedProperty("providedRoom")
    @providedRoom.setter
    def providedRoom(self, value: str):
        self.setScryptedProperty("providedRoom", value)

    @property
    def providedType(self) -> ScryptedDeviceType:
        return self.getScryptedProperty("providedType")
    @providedType.setter
    def providedType(self, value: ScryptedDeviceType):
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
    def type(self) -> ScryptedDeviceType:
        return self.getScryptedProperty("type")
    @type.setter
    def type(self, value: ScryptedDeviceType):
        self.setScryptedProperty("type", value)

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
    def thermostatActiveMode(self) -> ThermostatMode:
        return self.getScryptedProperty("thermostatActiveMode")
    @thermostatActiveMode.setter
    def thermostatActiveMode(self, value: ThermostatMode):
        self.setScryptedProperty("thermostatActiveMode", value)

    @property
    def thermostatAvailableModes(self) -> list[ThermostatMode]:
        return self.getScryptedProperty("thermostatAvailableModes")
    @thermostatAvailableModes.setter
    def thermostatAvailableModes(self, value: list[ThermostatMode]):
        self.setScryptedProperty("thermostatAvailableModes", value)

    @property
    def thermostatMode(self) -> ThermostatMode:
        return self.getScryptedProperty("thermostatMode")
    @thermostatMode.setter
    def thermostatMode(self, value: ThermostatMode):
        self.setScryptedProperty("thermostatMode", value)

    @property
    def thermostatSetpoint(self) -> float:
        return self.getScryptedProperty("thermostatSetpoint")
    @thermostatSetpoint.setter
    def thermostatSetpoint(self, value: float):
        self.setScryptedProperty("thermostatSetpoint", value)

    @property
    def thermostatSetpointHigh(self) -> float:
        return self.getScryptedProperty("thermostatSetpointHigh")
    @thermostatSetpointHigh.setter
    def thermostatSetpointHigh(self, value: float):
        self.setScryptedProperty("thermostatSetpointHigh", value)

    @property
    def thermostatSetpointLow(self) -> float:
        return self.getScryptedProperty("thermostatSetpointLow")
    @thermostatSetpointLow.setter
    def thermostatSetpointLow(self, value: float):
        self.setScryptedProperty("thermostatSetpointLow", value)

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
      "setTemperature",
      "setThermostatMode",
      "setThermostatSetpoint",
      "setThermostatSetpointHigh",
      "setThermostatSetpointLow"
    ],
    "properties": [
      "temperatureSetting",
      "thermostatActiveMode",
      "thermostatAvailableModes",
      "thermostatMode",
      "thermostatSetpoint",
      "thermostatSetpointHigh",
      "thermostatSetpointLow"
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
  "VideoRecorder": {
    "name": "VideoRecorder",
    "methods": [
      "getRecordingStream",
      "getRecordingStreamCurrentTime",
      "getRecordingStreamOptions",
      "getRecordingStreamThumbnail"
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
      "getVideoClipThumbnail",
      "getVideoClips",
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
  }
}

class EventListenerRegister:
    def removeListener(self) -> None:
        pass
    pass

class HttpResponse:
    def send(self, body: str) -> None:
        pass
    def sendFile(self, path: str) -> None:
        pass
    def sendSocket(self, socket: Any, options: HttpResponseOptions) -> None:
        pass
    pass

class ObjectDetectionCallbacks:
    async def onDetection(self, detection: ObjectsDetected, redetect: Any = None, mediaObject: MediaObject = None) -> bool:
        pass
    async def onDetectionEnded(self, detection: ObjectsDetected) -> None:
        pass
    pass

class VideoFrame:
    height: float
    timestamp: float
    width: float
    async def toBuffer(self, options: ImageOptions = None) -> bytearray:
        pass
    async def toImage(self, options: ImageOptions = None) -> Any:
        pass
    pass

