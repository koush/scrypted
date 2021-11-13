from __future__ import annotations
from enum import Enum
from typing import TypedDict
from typing import Any
from typing import Callable

SettingValue = str
EventListener = Callable[[Any, Any, Any], None]


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
    Sensor = "Sensor"
    Speaker = "Speaker"
    Switch = "Switch"
    Thermostat = "Thermostat"
    Unknown = "Unknown"
    Vacuum = "Vacuum"
    Valve = "Valve"

class ScryptedInterface(Enum):
    AudioSensor = "AudioSensor"
    Authenticator = "Authenticator"
    Battery = "Battery"
    BinarySensor = "BinarySensor"
    Brightness = "Brightness"
    BufferConverter = "BufferConverter"
    Camera = "Camera"
    ColorSettingHsv = "ColorSettingHsv"
    ColorSettingRgb = "ColorSettingRgb"
    ColorSettingTemperature = "ColorSettingTemperature"
    DeviceProvider = "DeviceProvider"
    Dock = "Dock"
    EngineIOHandler = "EngineIOHandler"
    Entry = "Entry"
    EntrySensor = "EntrySensor"
    Fan = "Fan"
    FloodSensor = "FloodSensor"
    HttpRequestHandler = "HttpRequestHandler"
    HumiditySensor = "HumiditySensor"
    HumiditySetting = "HumiditySetting"
    Intercom = "Intercom"
    IntrusionSensor = "IntrusionSensor"
    Lock = "Lock"
    LuminanceSensor = "LuminanceSensor"
    MediaPlayer = "MediaPlayer"
    MediaSource = "MediaSource"
    MixinProvider = "MixinProvider"
    MotionSensor = "MotionSensor"
    Notifier = "Notifier"
    OauthClient = "OauthClient"
    ObjectDetector = "ObjectDetector"
    OccupancySensor = "OccupancySensor"
    OnOff = "OnOff"
    Online = "Online"
    PasswordStore = "PasswordStore"
    Pause = "Pause"
    PositionSensor = "PositionSensor"
    PowerSensor = "PowerSensor"
    Program = "Program"
    PushHandler = "PushHandler"
    Refresh = "Refresh"
    Scene = "Scene"
    Scriptable = "Scriptable"
    ScryptedDevice = "ScryptedDevice"
    Settings = "Settings"
    SoftwareUpdate = "SoftwareUpdate"
    StartStop = "StartStop"
    TemperatureSetting = "TemperatureSetting"
    Thermometer = "Thermometer"
    UltravioletSensor = "UltravioletSensor"
    VideoCamera = "VideoCamera"

class ScryptedMimeTypes(Enum):
    AcceptUrlParameter = "accept-url"
    FFmpegInput = "x-scrypted/x-ffmpeg-input"
    InsecureLocalUrl = "text/x-insecure-local-uri"
    LocalUrl = "text/x-local-uri"
    PushEndpoint = "text/x-push-endpoint"
    RTCAVAnswer = "x-scrypted/x-rtc-av-answer"
    RTCAVOffer = "x-scrypted/x-rtc-av-offer"
    Url = "text/x-uri"

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


class FaceRecognition(TypedDict):
    boundingBox: Any
    id: str
    label: str
    score: float
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

class DeviceInformation(TypedDict):
    firmware: str
    manufacturer: str
    metadata: Any
    model: str
    serialNumber: str
    version: str
    pass

class EventDetails(TypedDict):
    changed: bool
    eventInterface: str
    eventTime: float
    property: str
    pass

class EventListenerOptions(TypedDict):
    denoise: bool
    event: str
    watch: bool
    pass

class EventListenerRegister(TypedDict):
    pass

class FanState(TypedDict):
    counterClockwise: bool
    mode: FanMode
    speed: float
    pass

class FanStatus(TypedDict):
    active: bool
    availableModes: list(FanMode)
    counterClockwise: bool
    maxSpeed: float
    mode: FanMode
    speed: float
    pass

class HttpRequest(TypedDict):
    body: str
    headers: object
    isPublicEndpoint: bool
    method: str
    rootPath: str
    url: str
    username: str
    pass

class HttpResponse(TypedDict):
    pass

class HumidityCommand(TypedDict):
    dehumidifierSetpoint: float
    humidifierSetpoint: float
    mode: HumidityMode
    pass

class HumiditySettingStatus(TypedDict):
    activeMode: HumidityMode
    availableModes: list(HumidityMode)
    dehumidifierSetpoint: float
    humidifierSetpoint: float
    mode: HumidityMode
    pass

class MediaObject(TypedDict):
    mimeType: str
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
    audio: Any
    container: str
    id: str
    name: str
    prebuffer: float
    video: Any
    pass

class ObjectDetectionTypes(TypedDict):
    detections: list(str)
    faces: bool
    people: list(FaceRecognition)
    pass

class PictureOptions(TypedDict):
    id: str
    name: str
    picture: Any
    pass

class Position(TypedDict):
    accuracyRadius: float
    latitude: float
    longitude: float
    pass

class ScriptSource(TypedDict):
    language: str
    monacoEvalDefaults: str
    name: str
    script: str
    pass

class AudioSensor:
    audioDetected: bool
    pass

class Authenticator:
    def checkPassword(password: str) -> bool:
        pass
    pass

class Battery:
    batteryLevel: float
    pass

class BinarySensor:
    binaryState: bool
    pass

class Brightness:
    brightness: float
    def setBrightness(brightness: float) -> None:
        pass
    pass

class BufferConverter:
    fromMimeType: str
    toMimeType: str
    def convert(data: str | bytearray, fromMimeType: str) -> None:
        pass
    pass

class Camera:
    def getPictureOptions() -> None:
        pass
    def takePicture(options: PictureOptions) -> MediaObject:
        pass
    pass

class ColorSettingHsv:
    hsv: ColorHsv
    def setHsv(hue: float, saturation: float, value: float) -> None:
        pass
    pass

class ColorSettingRgb:
    rgb: ColorRgb
    def setRgb(r: float, g: float, b: float) -> None:
        pass
    pass

class ColorSettingTemperature:
    colorTemperature: float
    def getTemperatureMaxK() -> float:
        pass
    def getTemperatureMinK() -> float:
        pass
    def setColorTemperature(kelvin: float) -> None:
        pass
    pass

class DeviceProvider:
    def discoverDevices(duration: float) -> None:
        pass
    def getDevice(nativeId: str) -> Any:
        pass
    pass

class Dock:
    docked: bool
    def dock() -> None:
        pass
    pass

class EngineIOHandler:
    def onConnection(request: HttpRequest, webSocketUrl: str) -> None:
        pass
    pass

class Entry:
    def closeEntry() -> None:
        pass
    def openEntry() -> None:
        pass
    pass

class EntrySensor:
    entryOpen: bool
    pass

class Fan:
    fan: FanStatus
    def setFan(fan: FanState) -> None:
        pass
    pass

class FloodSensor:
    flooded: bool
    pass

class HttpRequestHandler:
    def onRequest(request: HttpRequest, response: HttpResponse) -> None:
        pass
    pass

class HumiditySensor:
    humidity: float
    pass

class HumiditySetting:
    humiditySetting: HumiditySettingStatus
    def setHumidity(humidity: HumidityCommand) -> None:
        pass
    pass

class Intercom:
    def startIntercom(media: MediaObject) -> None:
        pass
    def stopIntercom() -> None:
        pass
    pass

class IntrusionSensor:
    intrusionDetected: bool
    pass

class Lock:
    lockState: LockState
    def lock() -> None:
        pass
    def unlock() -> None:
        pass
    pass

class LuminanceSensor:
    luminance: float
    pass

class MediaPlayer:
    def getMediaStatus() -> MediaStatus:
        pass
    def load(media: str | MediaObject, options: MediaPlayerOptions) -> None:
        pass
    def seek(milliseconds: float) -> None:
        pass
    def skipNext() -> None:
        pass
    def skipPrevious() -> None:
        pass
    pass

class MediaSource:
    def getMedia() -> MediaObject:
        pass
    pass

class MixinProvider:
    def canMixin(type: ScryptedDeviceType, interfaces: list(str)) -> None:
        pass
    def getMixin(mixinDevice: Any, mixinDeviceInterfaces: list(ScryptedInterface), mixinDeviceState: Any) -> Any:
        pass
    def releaseMixin(id: str, mixinDevice: Any) -> None:
        pass
    pass

class MotionSensor:
    motionDetected: bool
    pass

class Notifier:
    def sendNotification(title: str, body: str, media: str | MediaObject, mimeType: str) -> None:
        pass
    pass

class OauthClient:
    def getOauthUrl() -> str:
        pass
    def onOauthCallback(callbackUrl: str) -> None:
        pass
    pass

class ObjectDetector:
    def getDetectionInput(detectionId: Any) -> MediaObject:
        pass
    def getObjectTypes() -> ObjectDetectionTypes:
        pass
    pass

class OccupancySensor:
    occupied: bool
    pass

class OnOff:
    on: bool
    def turnOff() -> None:
        pass
    def turnOn() -> None:
        pass
    pass

class Online:
    online: bool
    pass

class PasswordStore:
    def addPassword(password: str) -> None:
        pass
    def getPasswords() -> None:
        pass
    def removePassword(password: str) -> None:
        pass
    pass

class Pause:
    paused: bool
    def pause() -> None:
        pass
    def resume() -> None:
        pass
    pass

class PositionSensor:
    position: Position
    pass

class PowerSensor:
    powerDetected: bool
    pass

class Program:
    def run(variables: Any) -> Any:
        pass
    pass

class PushHandler:
    def onPush(request: HttpRequest) -> None:
        pass
    pass

class Refresh:
    def getRefreshFrequency() -> float:
        pass
    def refresh(refreshInterface: str, userInitiated: bool) -> None:
        pass
    pass

class Scene:
    def activate() -> None:
        pass
    def deactivate() -> None:
        pass
    def isReversible() -> bool:
        pass
    pass

class Scriptable:
    def eval(source: ScriptSource, variables: Any) -> Any:
        pass
    def loadScripts() -> None:
        pass
    def saveScript(script: ScriptSource) -> None:
        pass
    pass

class ScryptedDevice:
    id: str
    info: DeviceInformation
    interfaces: list(str)
    mixins: list(str)
    name: str
    providedInterfaces: list(str)
    providedName: ScryptedDeviceType
    providedRoom: str
    providedType: ScryptedDeviceType
    providerId: str
    room: str
    type: ScryptedDeviceType
    def listen(event: str | EventListenerOptions, callback: EventListener) -> EventListenerRegister:
        pass
    def setName(name: str) -> None:
        pass
    def setRoom(room: str) -> None:
        pass
    def setType(type: ScryptedDeviceType) -> None:
        pass
    pass

class Settings:
    def getSettings() -> None:
        pass
    def putSetting(key: str, value: SettingValue) -> None:
        pass
    pass

class SoftwareUpdate:
    updateAvailable: bool
    def checkForUpdate() -> None:
        pass
    def installUpdate() -> None:
        pass
    pass

class StartStop:
    running: bool
    def start() -> None:
        pass
    def stop() -> None:
        pass
    pass

class TemperatureSetting:
    thermostatActiveMode: ThermostatMode
    thermostatAvailableModes: list(ThermostatMode)
    thermostatMode: ThermostatMode
    thermostatSetpoint: float
    thermostatSetpointHigh: float
    thermostatSetpointLow: float
    def setThermostatMode(mode: ThermostatMode) -> None:
        pass
    def setThermostatSetpoint(degrees: float) -> None:
        pass
    def setThermostatSetpointHigh(high: float) -> None:
        pass
    def setThermostatSetpointLow(low: float) -> None:
        pass
    pass

class Thermometer:
    temperature: float
    temperatureUnit: TemperatureUnit
    pass

class UltravioletSensor:
    ultraviolet: float
    pass

class VideoCamera:
    def getVideoStream(options: MediaStreamOptions) -> MediaObject:
        pass
    def getVideoStreamOptions() -> None:
        pass
    pass

