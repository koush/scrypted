from __future__ import annotations
from enum import Enum
from typing import TypedDict
from typing import Any
from typing import Callable

from .other import *


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

class Device(TypedDict):
    info: DeviceInformation
    interfaces: list(str)
    name: str
    nativeId: str
    providerNativeId: str
    room: str
    type: ScryptedDeviceType
    pass

class DeviceInformation(TypedDict):
    firmware: str
    manufacturer: str
    metadata: Any
    model: str
    serialNumber: str
    version: str
    pass

class DeviceManifest(TypedDict):
    devices: list(Device)
    providerNativeId: str
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

class Logger(TypedDict):
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

class ScryptedDevice(TypedDict):
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
    pass

class AudioSensor:
    audioDetected: bool
    pass

class Authenticator:
    async def checkPassword(self, password: str) -> bool:
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
    async def setBrightness(self, brightness: float) -> None:
        pass
    pass

class BufferConverter:
    fromMimeType: str
    toMimeType: str
    async def convert(self, data: str | bytearray, fromMimeType: str) -> None:
        pass
    pass

class Camera:
    async def getPictureOptions(self) -> None:
        pass
    async def takePicture(self, options: PictureOptions = None) -> MediaObject:
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

class DeviceProvider:
    async def discoverDevices(self, duration: float) -> None:
        pass
    def getDevice(self, nativeId: str) -> Any:
        pass
    pass

class Dock:
    docked: bool
    async def dock(self) -> None:
        pass
    pass

class EngineIOHandler:
    async def onConnection(self, request: HttpRequest, webSocketUrl: str) -> None:
        pass
    pass

class Entry:
    async def closeEntry(self) -> None:
        pass
    async def openEntry(self) -> None:
        pass
    pass

class EntrySensor:
    entryOpen: bool
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

class IntrusionSensor:
    intrusionDetected: bool
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

class MediaSource:
    def getMedia(self) -> MediaObject:
        pass
    pass

class MixinProvider:
    async def canMixin(self, type: ScryptedDeviceType, interfaces: list(str)) -> None:
        pass
    async def getMixin(self, mixinDevice: Any, mixinDeviceInterfaces: list(ScryptedInterface), mixinDeviceState: Any) -> Any:
        pass
    async def releaseMixin(self, id: str, mixinDevice: Any) -> None:
        pass
    pass

class MotionSensor:
    motionDetected: bool
    pass

class Notifier:
    async def sendNotification(self, title: str, body: str, media: str | MediaObject, mimeType: str = None) -> None:
        pass
    pass

class OauthClient:
    async def getOauthUrl(self) -> str:
        pass
    async def onOauthCallback(self, callbackUrl: str) -> None:
        pass
    pass

class ObjectDetector:
    async def getDetectionInput(self, detectionId: Any) -> MediaObject:
        pass
    async def getObjectTypes(self) -> ObjectDetectionTypes:
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

class PasswordStore:
    async def addPassword(self, password: str) -> None:
        pass
    async def getPasswords(self) -> None:
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
    async def loadScripts(self) -> None:
        pass
    async def saveScript(self, script: ScriptSource) -> None:
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
    def listen(self, event: str | EventListenerOptions, callback: EventListener) -> EventListenerRegister:
        pass
    async def setName(self, name: str) -> None:
        pass
    async def setRoom(self, room: str) -> None:
        pass
    async def setType(self, type: ScryptedDeviceType) -> None:
        pass
    pass

class Settings:
    async def getSettings(self) -> None:
        pass
    async def putSetting(self, key: str, value: SettingValue) -> None:
        pass
    pass

class SoftwareUpdate:
    updateAvailable: bool
    async def checkForUpdate(self) -> None:
        pass
    async def installUpdate(self) -> None:
        pass
    pass

class StartStop:
    running: bool
    async def start(self) -> None:
        pass
    async def stop(self) -> None:
        pass
    pass

class TemperatureSetting:
    thermostatActiveMode: ThermostatMode
    thermostatAvailableModes: list(ThermostatMode)
    thermostatMode: ThermostatMode
    thermostatSetpoint: float
    thermostatSetpointHigh: float
    thermostatSetpointLow: float
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
    pass

class UltravioletSensor:
    ultraviolet: float
    pass

class VideoCamera:
    async def getVideoStream(self, options: MediaStreamOptions = None) -> MediaObject:
        pass
    async def getVideoStreamOptions(self) -> None:
        pass
    pass

class DeviceManager:
    def getDeviceConsole(self, nativeId: str = None) -> Console:
        pass
    def getDeviceLogger(self, nativeId: str = None) -> Logger:
        pass
    def getDeviceState(self, nativeId: str = None) -> DeviceState:
        pass
    def getDeviceStorage(self) -> Storage:
        pass
    def getMixinConsole(self, mixinId: str, nativeId: str = None) -> Console:
        pass
    def getMixinStorage(self, id: str, nativeId: str = None) -> Storage:
        pass
    def getNativeIds(self) -> list(str):
        pass
    async def onDeviceDiscovered(self, device: Device) -> None:
        pass
    async def onDeviceEvent(self, nativeId: str, eventInterface: str, eventData: Any) -> None:
        pass
    async def onDeviceRemoved(self, nativeId: str) -> None:
        pass
    async def onDevicesChanged(self, devices: DeviceManifest) -> None:
        pass
    async def onMixinEvent(self, id: str, nativeId: str, eventInterface: str, eventData: Any) -> None:
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
    def listen(self, EventListener: EventListener) -> EventListenerRegister:
        pass
    def listenDevice(self, id: str, event: str | EventListenerOptions, callback: EventListener) -> EventListenerRegister:
        pass
    async def removeDevice(self, id: str) -> None:
        pass
    pass

class ScryptedInterfaceProperty(Enum):
    id = "id"
    info = "info"
    interfaces = "interfaces"
    mixins = "mixins"
    name = "name"
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
    thermostatActiveMode = "thermostatActiveMode"
    thermostatAvailableModes = "thermostatAvailableModes"
    thermostatMode = "thermostatMode"
    thermostatSetpoint = "thermostatSetpoint"
    thermostatSetpointHigh = "thermostatSetpointHigh"
    thermostatSetpointLow = "thermostatSetpointLow"
    temperature = "temperature"
    temperatureUnit = "temperatureUnit"
    humidity = "humidity"
    lockState = "lockState"
    entryOpen = "entryOpen"
    batteryLevel = "batteryLevel"
    online = "online"
    updateAvailable = "updateAvailable"
    fromMimeType = "fromMimeType"
    toMimeType = "toMimeType"
    binaryState = "binaryState"
    intrusionDetected = "intrusionDetected"
    powerDetected = "powerDetected"
    audioDetected = "audioDetected"
    motionDetected = "motionDetected"
    occupied = "occupied"
    flooded = "flooded"
    ultraviolet = "ultraviolet"
    luminance = "luminance"
    position = "position"
    humiditySetting = "humiditySetting"
    fan = "fan"

class DeviceState:
    def getScryptedProperty(self, property: str) -> Any:
        pass
    def setScryptedProperty(self, property: str, value: Any):
        pass

    @property
    def id(self) -> str:
        self.getScryptedProperty("id")
    @id.setter
    def id(self, value: str):
        self.setScryptedProperty("id", value)

    @property
    def info(self) -> DeviceInformation:
        self.getScryptedProperty("info")
    @info.setter
    def info(self, value: DeviceInformation):
        self.setScryptedProperty("info", value)

    @property
    def interfaces(self) -> list(str):
        self.getScryptedProperty("interfaces")
    @interfaces.setter
    def interfaces(self, value: list(str)):
        self.setScryptedProperty("interfaces", value)

    @property
    def mixins(self) -> list(str):
        self.getScryptedProperty("mixins")
    @mixins.setter
    def mixins(self, value: list(str)):
        self.setScryptedProperty("mixins", value)

    @property
    def name(self) -> str:
        self.getScryptedProperty("name")
    @name.setter
    def name(self, value: str):
        self.setScryptedProperty("name", value)

    @property
    def providedInterfaces(self) -> list(str):
        self.getScryptedProperty("providedInterfaces")
    @providedInterfaces.setter
    def providedInterfaces(self, value: list(str)):
        self.setScryptedProperty("providedInterfaces", value)

    @property
    def providedName(self) -> ScryptedDeviceType:
        self.getScryptedProperty("providedName")
    @providedName.setter
    def providedName(self, value: ScryptedDeviceType):
        self.setScryptedProperty("providedName", value)

    @property
    def providedRoom(self) -> str:
        self.getScryptedProperty("providedRoom")
    @providedRoom.setter
    def providedRoom(self, value: str):
        self.setScryptedProperty("providedRoom", value)

    @property
    def providedType(self) -> ScryptedDeviceType:
        self.getScryptedProperty("providedType")
    @providedType.setter
    def providedType(self, value: ScryptedDeviceType):
        self.setScryptedProperty("providedType", value)

    @property
    def providerId(self) -> str:
        self.getScryptedProperty("providerId")
    @providerId.setter
    def providerId(self, value: str):
        self.setScryptedProperty("providerId", value)

    @property
    def room(self) -> str:
        self.getScryptedProperty("room")
    @room.setter
    def room(self, value: str):
        self.setScryptedProperty("room", value)

    @property
    def type(self) -> ScryptedDeviceType:
        self.getScryptedProperty("type")
    @type.setter
    def type(self, value: ScryptedDeviceType):
        self.setScryptedProperty("type", value)

    @property
    def on(self) -> bool:
        self.getScryptedProperty("on")
    @on.setter
    def on(self, value: bool):
        self.setScryptedProperty("on", value)

    @property
    def brightness(self) -> float:
        self.getScryptedProperty("brightness")
    @brightness.setter
    def brightness(self, value: float):
        self.setScryptedProperty("brightness", value)

    @property
    def colorTemperature(self) -> float:
        self.getScryptedProperty("colorTemperature")
    @colorTemperature.setter
    def colorTemperature(self, value: float):
        self.setScryptedProperty("colorTemperature", value)

    @property
    def rgb(self) -> ColorRgb:
        self.getScryptedProperty("rgb")
    @rgb.setter
    def rgb(self, value: ColorRgb):
        self.setScryptedProperty("rgb", value)

    @property
    def hsv(self) -> ColorHsv:
        self.getScryptedProperty("hsv")
    @hsv.setter
    def hsv(self, value: ColorHsv):
        self.setScryptedProperty("hsv", value)

    @property
    def running(self) -> bool:
        self.getScryptedProperty("running")
    @running.setter
    def running(self, value: bool):
        self.setScryptedProperty("running", value)

    @property
    def paused(self) -> bool:
        self.getScryptedProperty("paused")
    @paused.setter
    def paused(self, value: bool):
        self.setScryptedProperty("paused", value)

    @property
    def docked(self) -> bool:
        self.getScryptedProperty("docked")
    @docked.setter
    def docked(self, value: bool):
        self.setScryptedProperty("docked", value)

    @property
    def thermostatActiveMode(self) -> ThermostatMode:
        self.getScryptedProperty("thermostatActiveMode")
    @thermostatActiveMode.setter
    def thermostatActiveMode(self, value: ThermostatMode):
        self.setScryptedProperty("thermostatActiveMode", value)

    @property
    def thermostatAvailableModes(self) -> list(ThermostatMode):
        self.getScryptedProperty("thermostatAvailableModes")
    @thermostatAvailableModes.setter
    def thermostatAvailableModes(self, value: list(ThermostatMode)):
        self.setScryptedProperty("thermostatAvailableModes", value)

    @property
    def thermostatMode(self) -> ThermostatMode:
        self.getScryptedProperty("thermostatMode")
    @thermostatMode.setter
    def thermostatMode(self, value: ThermostatMode):
        self.setScryptedProperty("thermostatMode", value)

    @property
    def thermostatSetpoint(self) -> float:
        self.getScryptedProperty("thermostatSetpoint")
    @thermostatSetpoint.setter
    def thermostatSetpoint(self, value: float):
        self.setScryptedProperty("thermostatSetpoint", value)

    @property
    def thermostatSetpointHigh(self) -> float:
        self.getScryptedProperty("thermostatSetpointHigh")
    @thermostatSetpointHigh.setter
    def thermostatSetpointHigh(self, value: float):
        self.setScryptedProperty("thermostatSetpointHigh", value)

    @property
    def thermostatSetpointLow(self) -> float:
        self.getScryptedProperty("thermostatSetpointLow")
    @thermostatSetpointLow.setter
    def thermostatSetpointLow(self, value: float):
        self.setScryptedProperty("thermostatSetpointLow", value)

    @property
    def temperature(self) -> float:
        self.getScryptedProperty("temperature")
    @temperature.setter
    def temperature(self, value: float):
        self.setScryptedProperty("temperature", value)

    @property
    def temperatureUnit(self) -> TemperatureUnit:
        self.getScryptedProperty("temperatureUnit")
    @temperatureUnit.setter
    def temperatureUnit(self, value: TemperatureUnit):
        self.setScryptedProperty("temperatureUnit", value)

    @property
    def humidity(self) -> float:
        self.getScryptedProperty("humidity")
    @humidity.setter
    def humidity(self, value: float):
        self.setScryptedProperty("humidity", value)

    @property
    def lockState(self) -> LockState:
        self.getScryptedProperty("lockState")
    @lockState.setter
    def lockState(self, value: LockState):
        self.setScryptedProperty("lockState", value)

    @property
    def entryOpen(self) -> bool:
        self.getScryptedProperty("entryOpen")
    @entryOpen.setter
    def entryOpen(self, value: bool):
        self.setScryptedProperty("entryOpen", value)

    @property
    def batteryLevel(self) -> float:
        self.getScryptedProperty("batteryLevel")
    @batteryLevel.setter
    def batteryLevel(self, value: float):
        self.setScryptedProperty("batteryLevel", value)

    @property
    def online(self) -> bool:
        self.getScryptedProperty("online")
    @online.setter
    def online(self, value: bool):
        self.setScryptedProperty("online", value)

    @property
    def updateAvailable(self) -> bool:
        self.getScryptedProperty("updateAvailable")
    @updateAvailable.setter
    def updateAvailable(self, value: bool):
        self.setScryptedProperty("updateAvailable", value)

    @property
    def fromMimeType(self) -> str:
        self.getScryptedProperty("fromMimeType")
    @fromMimeType.setter
    def fromMimeType(self, value: str):
        self.setScryptedProperty("fromMimeType", value)

    @property
    def toMimeType(self) -> str:
        self.getScryptedProperty("toMimeType")
    @toMimeType.setter
    def toMimeType(self, value: str):
        self.setScryptedProperty("toMimeType", value)

    @property
    def binaryState(self) -> bool:
        self.getScryptedProperty("binaryState")
    @binaryState.setter
    def binaryState(self, value: bool):
        self.setScryptedProperty("binaryState", value)

    @property
    def intrusionDetected(self) -> bool:
        self.getScryptedProperty("intrusionDetected")
    @intrusionDetected.setter
    def intrusionDetected(self, value: bool):
        self.setScryptedProperty("intrusionDetected", value)

    @property
    def powerDetected(self) -> bool:
        self.getScryptedProperty("powerDetected")
    @powerDetected.setter
    def powerDetected(self, value: bool):
        self.setScryptedProperty("powerDetected", value)

    @property
    def audioDetected(self) -> bool:
        self.getScryptedProperty("audioDetected")
    @audioDetected.setter
    def audioDetected(self, value: bool):
        self.setScryptedProperty("audioDetected", value)

    @property
    def motionDetected(self) -> bool:
        self.getScryptedProperty("motionDetected")
    @motionDetected.setter
    def motionDetected(self, value: bool):
        self.setScryptedProperty("motionDetected", value)

    @property
    def occupied(self) -> bool:
        self.getScryptedProperty("occupied")
    @occupied.setter
    def occupied(self, value: bool):
        self.setScryptedProperty("occupied", value)

    @property
    def flooded(self) -> bool:
        self.getScryptedProperty("flooded")
    @flooded.setter
    def flooded(self, value: bool):
        self.setScryptedProperty("flooded", value)

    @property
    def ultraviolet(self) -> float:
        self.getScryptedProperty("ultraviolet")
    @ultraviolet.setter
    def ultraviolet(self, value: float):
        self.setScryptedProperty("ultraviolet", value)

    @property
    def luminance(self) -> float:
        self.getScryptedProperty("luminance")
    @luminance.setter
    def luminance(self, value: float):
        self.setScryptedProperty("luminance", value)

    @property
    def position(self) -> Position:
        self.getScryptedProperty("position")
    @position.setter
    def position(self, value: Position):
        self.setScryptedProperty("position", value)

    @property
    def humiditySetting(self) -> HumiditySettingStatus:
        self.getScryptedProperty("humiditySetting")
    @humiditySetting.setter
    def humiditySetting(self, value: HumiditySettingStatus):
        self.setScryptedProperty("humiditySetting", value)

    @property
    def fan(self) -> FanStatus:
        self.getScryptedProperty("fan")
    @fan.setter
    def fan(self, value: FanStatus):
        self.setScryptedProperty("fan", value)

