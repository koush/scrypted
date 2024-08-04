from __future__ import annotations
from enum import Enum
try:
    from typing import TypedDict
except:
    from typing_extensions import TypedDict
from typing import Union, Any, AsyncGenerator

from .other import *



class AirQuality(TypedDict):

    pass


class ChargeState(TypedDict):

    pass


class LockState(TypedDict):

    pass


class ScryptedDeviceType(TypedDict):

    pass


class TemperatureUnit(TypedDict):

    pass


class AirPurifierState(TypedDict):

    pass


class AudioVolumes(TypedDict):

    pass


class ColorHsv(TypedDict):
    """Represents an HSV color value component."""

    pass


class ColorRgb(TypedDict):
    """Represents an RGB color with component values between 0 and 255."""

    pass


class DeviceInformation(TypedDict):

    pass


class EventDetails(TypedDict):

    pass


class FanStatus(TypedDict):

    pass


class HumiditySettingStatus(TypedDict):

    pass


class LauncherApplicationInfo(TypedDict):

    pass


class PanTiltZoomCapabilities(TypedDict):

    pass


class Position(TypedDict):

    pass


class ScryptedRuntimeArguments(TypedDict):

    pass


class ScryptedSystemDeviceInfo(TypedDict):

    pass


class SecuritySystemState(TypedDict):

    pass


class TemperatureSettingStatus(TypedDict):

    pass


class MediaConverterTypes(TypedDict):
    """[fromMimeType, toMimeType]"""

    pass


class TamperState(TypedDict):

    pass


class AirPurifier:


class AirQualitySensor:


class AmbientLightSensor:


class AudioSensor:


class AudioVolumeControl:


class Battery:
    """Battery retrieves the battery level of battery powered devices."""


class BinarySensor:


class Brightness:
    """Brightness is a lighting device that can be dimmed/lit between 0 to 100."""


class BufferConverter:
    """Add a converter to be used by Scrypted to convert buffers from one mime type to another mime type. May optionally accept string urls if accept-url is a fromMimeType parameter."""


class CO2Sensor:


class Camera:
    """Camera devices can take still photos."""


class Charger:
    """Charger reports whether or not a device is being charged from an external power source. Usually used for battery powered devices."""


class ColorSettingHsv:
    """ColorSettingHsv sets the color of a colored light using the HSV representation."""


class ColorSettingRgb:
    """ColorSettingRgb sets the color of a colored light using the RGB representation."""


class ColorSettingTemperature:
    """ColorSettingTemperature sets the color temperature of a light in Kelvin."""


class DeviceCreator:
    """A DeviceProvider that allows the user to create a device."""


class DeviceDiscovery:
    """A DeviceProvider that has a device discovery mechanism."""


class DeviceProvider:
    """DeviceProvider acts as a controller/hub and exposes multiple devices to Scrypted Device Manager."""


class Display:
    """Display devices can play back audio and video."""


class Dock:
    """Dock instructs devices that have a base station or charger, to return to their home."""


class EngineIOHandler:


class Entry:
    """Entry represents devices that can open and close barriers, such as garage doors."""


class EntrySensor:


class EventRecorder:


class Fan:


class FilterMaintenance:


class FloodSensor:


class HttpRequestHandler:
    """The HttpRequestHandler allows handling of web requests under the endpoint path: /endpoint/npm-package-name/*."""


class HumiditySensor:


class HumiditySetting:


class Intercom:
    """Intercom devices can playback audio."""


class LauncherApplication:


class Lock:
    """Lock controls devices that can lock or unlock entries. Often works in tandem with PasswordControl."""


class LuminanceSensor:


class MediaConverter:


class MediaPlayer:
    """MediaPlayer allows media playback on screen or speaker devices, such as Chromecasts or TVs."""


class Microphone:
    """Microphone devices can capture audio streams."""


class MixinProvider:
    """MixinProviders can add and intercept interfaces to other devices to add or augment their behavior."""


class MotionSensor:


class NOXSensor:


class Notifier:
    """Notifier can be any endpoint that can receive messages, such as speakers, phone numbers, messaging clients, etc. The messages may optionally contain media."""


class OauthClient:
    """The OauthClient can be implemented to perform the browser based Oauth process from within a plugin."""


class ObjectDetection:
    """ObjectDetection can run classifications or analysis on arbitrary media sources. E.g. TensorFlow, OpenCV, or a Coral TPU."""


class ObjectDetectionGenerator:


    pass

class ObjectDetectionPreview:


    pass

class ObjectDetector:
    """ObjectDetector is found on Cameras that have smart detection capabilities."""


class ObjectTracker:
    """Given object detections with bounding boxes, return a similar list with tracker ids."""


class OccupancySensor:


class OnOff:
    """OnOff is a basic binary switch."""


class Online:
    """Online denotes whether the device is online or unresponsive. It may be unresponsive due to being unplugged, network error, etc."""


class PM10Sensor:


class PM25Sensor:


class PanTiltZoom:


class PasswordStore:
    """PasswordControl represents devices that authorize users via a passcode or pin code."""


class Pause:


class PositionSensor:


class PowerSensor:


class Program:


class PushHandler:


class Readme:


class Reboot:


class Refresh:
    """Refresh indicates that this device has properties that are not automatically updated, and must be periodically refreshed via polling. Device implementations should never implement their own underlying polling algorithm, and instead implement Refresh to allow Scrypted to manage polling intelligently."""


class Scene:
    """Scenes control multiple different devices into a given state."""


class Scriptable:


class ScryptedDevice:
    """All devices in Scrypted implement ScryptedDevice, which contains the id, name, and type. Add listeners to subscribe to events from that device."""


class ScryptedDeviceCreator:


    pass

class ScryptedPlugin:


class ScryptedPluginRuntime:


class ScryptedSettings:


    pass

class ScryptedSystemDevice:
    """SystemDevices are listed in the Scrypted UI."""


class ScryptedUser:
    """ScryptedUser represents a user managed by Scrypted. This interface can not be implemented, only extended by Mixins."""


class SecuritySystem:


class Settings:
    """Settings viewing and editing of device configurations that describe or modify behavior."""


class StartStop:
    """StartStop represents a device that can be started, stopped, and possibly paused and resumed. Typically vacuum cleaners or washers."""


class StreamService:
    """Generic bidirectional stream connection."""


class TTY:
    """TTY connection offered by a remote device that can be connected to by an interactive terminal interface.  Implementors should also implement StreamService to handle the actual data transfer."""


    pass

class TamperSensor:


class TemperatureSetting:
    """TemperatureSetting represents a thermostat device."""


class Thermometer:


class UltravioletSensor:


class VOCSensor:


class VideoCamera:
    """VideoCamera devices can capture video streams."""


class VideoCameraConfiguration:


class VideoCameraMask:


class VideoClips:


class VideoFrameGenerator:


class VideoRecorder:


class VideoRecorderManagement:


class Logger:
    """Logger is exposed via log.* to allow writing to the Scrypted log."""


class DeviceManager:
    """DeviceManager is the interface used by DeviceProvider to report new devices, device states, and device events to Scrypted."""


class SystemManager:
    """SystemManager is used by scripts to query device state and access devices."""


class MediaManager:


class EndpointManager:
    """EndpointManager provides publicly accessible URLs that can be used to contact your Scrypted Plugin."""


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
    getRecordingStream = "getRecordingStream"
    getRecordingStreamCurrentTime = "getRecordingStreamCurrentTime"
    getRecordingStreamOptions = "getRecordingStreamOptions"
    getRecordingStreamThumbnail = "getRecordingStreamThumbnail"
    deleteRecordingStream = "deleteRecordingStream"
    setRecordingActive = "setRecordingActive"
    ptzCommand = "ptzCommand"
    getRecordedEvents = "getRecordedEvents"
    getVideoClip = "getVideoClip"
    getVideoClipThumbnail = "getVideoClipThumbnail"
    getVideoClips = "getVideoClips"
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

