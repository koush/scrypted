"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScryptedMimeTypes = exports.ScryptedInterface = exports.MediaPlayerState = exports.LockState = exports.ThermostatMode = exports.TemperatureUnit = exports.FanMode = exports.HumidityMode = exports.ScryptedDeviceType = exports.ScryptedInterfaceDescriptors = exports.ScryptedInterfaceProperty = exports.DeviceBase = void 0;
class DeviceBase {
}
exports.DeviceBase = DeviceBase;
var ScryptedInterfaceProperty;
(function (ScryptedInterfaceProperty) {
    ScryptedInterfaceProperty["id"] = "id";
    ScryptedInterfaceProperty["info"] = "info";
    ScryptedInterfaceProperty["interfaces"] = "interfaces";
    ScryptedInterfaceProperty["mixins"] = "mixins";
    ScryptedInterfaceProperty["name"] = "name";
    ScryptedInterfaceProperty["providedInterfaces"] = "providedInterfaces";
    ScryptedInterfaceProperty["providedName"] = "providedName";
    ScryptedInterfaceProperty["providedRoom"] = "providedRoom";
    ScryptedInterfaceProperty["providedType"] = "providedType";
    ScryptedInterfaceProperty["providerId"] = "providerId";
    ScryptedInterfaceProperty["room"] = "room";
    ScryptedInterfaceProperty["type"] = "type";
    ScryptedInterfaceProperty["on"] = "on";
    ScryptedInterfaceProperty["brightness"] = "brightness";
    ScryptedInterfaceProperty["colorTemperature"] = "colorTemperature";
    ScryptedInterfaceProperty["rgb"] = "rgb";
    ScryptedInterfaceProperty["hsv"] = "hsv";
    ScryptedInterfaceProperty["running"] = "running";
    ScryptedInterfaceProperty["paused"] = "paused";
    ScryptedInterfaceProperty["docked"] = "docked";
    ScryptedInterfaceProperty["thermostatActiveMode"] = "thermostatActiveMode";
    ScryptedInterfaceProperty["thermostatAvailableModes"] = "thermostatAvailableModes";
    ScryptedInterfaceProperty["thermostatMode"] = "thermostatMode";
    ScryptedInterfaceProperty["thermostatSetpoint"] = "thermostatSetpoint";
    ScryptedInterfaceProperty["thermostatSetpointHigh"] = "thermostatSetpointHigh";
    ScryptedInterfaceProperty["thermostatSetpointLow"] = "thermostatSetpointLow";
    ScryptedInterfaceProperty["temperature"] = "temperature";
    ScryptedInterfaceProperty["temperatureUnit"] = "temperatureUnit";
    ScryptedInterfaceProperty["humidity"] = "humidity";
    ScryptedInterfaceProperty["lockState"] = "lockState";
    ScryptedInterfaceProperty["entryOpen"] = "entryOpen";
    ScryptedInterfaceProperty["batteryLevel"] = "batteryLevel";
    ScryptedInterfaceProperty["online"] = "online";
    ScryptedInterfaceProperty["updateAvailable"] = "updateAvailable";
    ScryptedInterfaceProperty["fromMimeType"] = "fromMimeType";
    ScryptedInterfaceProperty["toMimeType"] = "toMimeType";
    ScryptedInterfaceProperty["binaryState"] = "binaryState";
    ScryptedInterfaceProperty["intrusionDetected"] = "intrusionDetected";
    ScryptedInterfaceProperty["powerDetected"] = "powerDetected";
    ScryptedInterfaceProperty["audioDetected"] = "audioDetected";
    ScryptedInterfaceProperty["motionDetected"] = "motionDetected";
    ScryptedInterfaceProperty["ambientLight"] = "ambientLight";
    ScryptedInterfaceProperty["occupied"] = "occupied";
    ScryptedInterfaceProperty["flooded"] = "flooded";
    ScryptedInterfaceProperty["ultraviolet"] = "ultraviolet";
    ScryptedInterfaceProperty["luminance"] = "luminance";
    ScryptedInterfaceProperty["position"] = "position";
    ScryptedInterfaceProperty["humiditySetting"] = "humiditySetting";
    ScryptedInterfaceProperty["fan"] = "fan";
})(ScryptedInterfaceProperty = exports.ScryptedInterfaceProperty || (exports.ScryptedInterfaceProperty = {}));
exports.ScryptedInterfaceDescriptors = {
    ScryptedDevice: {
        name: 'ScryptedDevice',
        methods: [
            'listen',
            'probe',
            'setName',
            'setRoom',
            'setType'
        ],
        properties: [
            'id',
            'info',
            'interfaces',
            'mixins',
            'name',
            'providedInterfaces',
            'providedName',
            'providedRoom',
            'providedType',
            'providerId',
            'room',
            'type'
        ]
    },
    ScryptedPlugin: {
        name: 'ScryptedPlugin',
        methods: [
            'getPluginJson'
        ],
        properties: []
    },
    OnOff: {
        name: 'OnOff',
        methods: [
            'turnOff',
            'turnOn'
        ],
        properties: [
            'on'
        ]
    },
    Brightness: {
        name: 'Brightness',
        methods: [
            'setBrightness'
        ],
        properties: [
            'brightness'
        ]
    },
    ColorSettingTemperature: {
        name: 'ColorSettingTemperature',
        methods: [
            'getTemperatureMaxK',
            'getTemperatureMinK',
            'setColorTemperature'
        ],
        properties: [
            'colorTemperature'
        ]
    },
    ColorSettingRgb: {
        name: 'ColorSettingRgb',
        methods: [
            'setRgb'
        ],
        properties: [
            'rgb'
        ]
    },
    ColorSettingHsv: {
        name: 'ColorSettingHsv',
        methods: [
            'setHsv'
        ],
        properties: [
            'hsv'
        ]
    },
    Notifier: {
        name: 'Notifier',
        methods: [
            'sendNotification'
        ],
        properties: []
    },
    StartStop: {
        name: 'StartStop',
        methods: [
            'start',
            'stop'
        ],
        properties: [
            'running'
        ]
    },
    Pause: {
        name: 'Pause',
        methods: [
            'pause',
            'resume'
        ],
        properties: [
            'paused'
        ]
    },
    Dock: {
        name: 'Dock',
        methods: [
            'dock'
        ],
        properties: [
            'docked'
        ]
    },
    TemperatureSetting: {
        name: 'TemperatureSetting',
        methods: [
            'setThermostatMode',
            'setThermostatSetpoint',
            'setThermostatSetpointHigh',
            'setThermostatSetpointLow'
        ],
        properties: [
            'thermostatActiveMode',
            'thermostatAvailableModes',
            'thermostatMode',
            'thermostatSetpoint',
            'thermostatSetpointHigh',
            'thermostatSetpointLow'
        ]
    },
    Thermometer: {
        name: 'Thermometer',
        methods: [
            'setTemperatureUnit'
        ],
        properties: [
            'temperature',
            'temperatureUnit'
        ]
    },
    HumiditySensor: {
        name: 'HumiditySensor',
        methods: [],
        properties: [
            'humidity'
        ]
    },
    Camera: {
        name: 'Camera',
        methods: [
            'getPictureOptions',
            'takePicture'
        ],
        properties: []
    },
    VideoCamera: {
        name: 'VideoCamera',
        methods: [
            'getVideoStream',
            'getVideoStreamOptions'
        ],
        properties: []
    },
    VideoCameraConfiguration: {
        name: 'VideoCameraConfiguration',
        methods: [
            'setVideoStreamOptions'
        ],
        properties: []
    },
    Intercom: {
        name: 'Intercom',
        methods: [
            'startIntercom',
            'stopIntercom'
        ],
        properties: []
    },
    Lock: {
        name: 'Lock',
        methods: [
            'lock',
            'unlock'
        ],
        properties: [
            'lockState'
        ]
    },
    PasswordStore: {
        name: 'PasswordStore',
        methods: [
            'addPassword',
            'getPasswords',
            'removePassword'
        ],
        properties: []
    },
    Authenticator: {
        name: 'Authenticator',
        methods: [
            'checkPassword'
        ],
        properties: []
    },
    Scene: {
        name: 'Scene',
        methods: [
            'activate',
            'deactivate',
            'isReversible'
        ],
        properties: []
    },
    Entry: {
        name: 'Entry',
        methods: [
            'closeEntry',
            'openEntry'
        ],
        properties: []
    },
    EntrySensor: {
        name: 'EntrySensor',
        methods: [],
        properties: [
            'entryOpen'
        ]
    },
    DeviceProvider: {
        name: 'DeviceProvider',
        methods: [
            'getDevice'
        ],
        properties: []
    },
    DeviceDiscovery: {
        name: 'DeviceDiscovery',
        methods: [
            'discoverDevices'
        ],
        properties: []
    },
    DeviceCreator: {
        name: 'DeviceCreator',
        methods: [
            'createDevice',
            'getCreateDeviceSettings'
        ],
        properties: []
    },
    Battery: {
        name: 'Battery',
        methods: [],
        properties: [
            'batteryLevel'
        ]
    },
    Refresh: {
        name: 'Refresh',
        methods: [
            'getRefreshFrequency',
            'refresh'
        ],
        properties: []
    },
    MediaPlayer: {
        name: 'MediaPlayer',
        methods: [
            'getMediaStatus',
            'load',
            'seek',
            'skipNext',
            'skipPrevious'
        ],
        properties: []
    },
    Online: {
        name: 'Online',
        methods: [],
        properties: [
            'online'
        ]
    },
    SoftwareUpdate: {
        name: 'SoftwareUpdate',
        methods: [
            'checkForUpdate',
            'installUpdate'
        ],
        properties: [
            'updateAvailable'
        ]
    },
    BufferConverter: {
        name: 'BufferConverter',
        methods: [
            'convert'
        ],
        properties: [
            'fromMimeType',
            'toMimeType'
        ]
    },
    Settings: {
        name: 'Settings',
        methods: [
            'getSettings',
            'putSetting'
        ],
        properties: []
    },
    BinarySensor: {
        name: 'BinarySensor',
        methods: [],
        properties: [
            'binaryState'
        ]
    },
    IntrusionSensor: {
        name: 'IntrusionSensor',
        methods: [],
        properties: [
            'intrusionDetected'
        ]
    },
    PowerSensor: {
        name: 'PowerSensor',
        methods: [],
        properties: [
            'powerDetected'
        ]
    },
    AudioSensor: {
        name: 'AudioSensor',
        methods: [],
        properties: [
            'audioDetected'
        ]
    },
    MotionSensor: {
        name: 'MotionSensor',
        methods: [],
        properties: [
            'motionDetected'
        ]
    },
    AmbientLightSensor: {
        name: 'AmbientLightSensor',
        methods: [],
        properties: [
            'ambientLight'
        ]
    },
    OccupancySensor: {
        name: 'OccupancySensor',
        methods: [],
        properties: [
            'occupied'
        ]
    },
    FloodSensor: {
        name: 'FloodSensor',
        methods: [],
        properties: [
            'flooded'
        ]
    },
    UltravioletSensor: {
        name: 'UltravioletSensor',
        methods: [],
        properties: [
            'ultraviolet'
        ]
    },
    LuminanceSensor: {
        name: 'LuminanceSensor',
        methods: [],
        properties: [
            'luminance'
        ]
    },
    PositionSensor: {
        name: 'PositionSensor',
        methods: [],
        properties: [
            'position'
        ]
    },
    Readme: {
        name: 'Readme',
        methods: [
            'getReadmeMarkdown'
        ],
        properties: []
    },
    OauthClient: {
        name: 'OauthClient',
        methods: [
            'getOauthUrl',
            'onOauthCallback'
        ],
        properties: []
    },
    MixinProvider: {
        name: 'MixinProvider',
        methods: [
            'canMixin',
            'getMixin',
            'releaseMixin'
        ],
        properties: []
    },
    HttpRequestHandler: {
        name: 'HttpRequestHandler',
        methods: [
            'onRequest'
        ],
        properties: []
    },
    EngineIOHandler: {
        name: 'EngineIOHandler',
        methods: [
            'onConnection'
        ],
        properties: []
    },
    PushHandler: {
        name: 'PushHandler',
        methods: [
            'onPush'
        ],
        properties: []
    },
    Program: {
        name: 'Program',
        methods: [
            'run'
        ],
        properties: []
    },
    Scriptable: {
        name: 'Scriptable',
        methods: [
            'eval',
            'loadScripts',
            'saveScript'
        ],
        properties: []
    },
    ObjectDetector: {
        name: 'ObjectDetector',
        methods: [
            'getDetectionInput',
            'getObjectTypes'
        ],
        properties: []
    },
    ObjectDetection: {
        name: 'ObjectDetection',
        methods: [
            'detectObjects',
            'getDetectionModel'
        ],
        properties: []
    },
    HumiditySetting: {
        name: 'HumiditySetting',
        methods: [
            'setHumidity'
        ],
        properties: [
            'humiditySetting'
        ]
    },
    Fan: {
        name: 'Fan',
        methods: [
            'setFan'
        ],
        properties: [
            'fan'
        ]
    }
};
var ScryptedDeviceType;
(function (ScryptedDeviceType) {
    ScryptedDeviceType["Builtin"] = "Builtin";
    ScryptedDeviceType["Camera"] = "Camera";
    ScryptedDeviceType["Fan"] = "Fan";
    ScryptedDeviceType["Light"] = "Light";
    ScryptedDeviceType["Switch"] = "Switch";
    ScryptedDeviceType["Outlet"] = "Outlet";
    ScryptedDeviceType["Sensor"] = "Sensor";
    ScryptedDeviceType["Scene"] = "Scene";
    ScryptedDeviceType["Program"] = "Program";
    ScryptedDeviceType["Automation"] = "Automation";
    ScryptedDeviceType["Vacuum"] = "Vacuum";
    ScryptedDeviceType["Notifier"] = "Notifier";
    ScryptedDeviceType["Thermostat"] = "Thermostat";
    ScryptedDeviceType["Lock"] = "Lock";
    ScryptedDeviceType["PasswordControl"] = "PasswordControl";
    ScryptedDeviceType["Display"] = "Display";
    ScryptedDeviceType["Speaker"] = "Speaker";
    ScryptedDeviceType["Event"] = "Event";
    ScryptedDeviceType["Entry"] = "Entry";
    ScryptedDeviceType["Garage"] = "Garage";
    ScryptedDeviceType["DeviceProvider"] = "DeviceProvider";
    ScryptedDeviceType["DataSource"] = "DataSource";
    ScryptedDeviceType["API"] = "API";
    ScryptedDeviceType["Doorbell"] = "Doorbell";
    ScryptedDeviceType["Irrigation"] = "Irrigation";
    ScryptedDeviceType["Valve"] = "Valve";
    ScryptedDeviceType["Person"] = "Person";
    ScryptedDeviceType["Unknown"] = "Unknown";
})(ScryptedDeviceType = exports.ScryptedDeviceType || (exports.ScryptedDeviceType = {}));
var HumidityMode;
(function (HumidityMode) {
    HumidityMode["Humidify"] = "Humidify";
    HumidityMode["Dehumidify"] = "Dehumidify";
    HumidityMode["Auto"] = "Auto";
    HumidityMode["Off"] = "Off";
})(HumidityMode = exports.HumidityMode || (exports.HumidityMode = {}));
var FanMode;
(function (FanMode) {
    FanMode["Auto"] = "Auto";
    FanMode["Manual"] = "Manual";
})(FanMode = exports.FanMode || (exports.FanMode = {}));
var TemperatureUnit;
(function (TemperatureUnit) {
    TemperatureUnit["C"] = "C";
    TemperatureUnit["F"] = "F";
})(TemperatureUnit = exports.TemperatureUnit || (exports.TemperatureUnit = {}));
var ThermostatMode;
(function (ThermostatMode) {
    ThermostatMode["Off"] = "Off";
    ThermostatMode["Cool"] = "Cool";
    ThermostatMode["Heat"] = "Heat";
    ThermostatMode["HeatCool"] = "HeatCool";
    ThermostatMode["Auto"] = "Auto";
    ThermostatMode["FanOnly"] = "FanOnly";
    ThermostatMode["Purifier"] = "Purifier";
    ThermostatMode["Eco"] = "Eco";
    ThermostatMode["Dry"] = "Dry";
    ThermostatMode["On"] = "On";
})(ThermostatMode = exports.ThermostatMode || (exports.ThermostatMode = {}));
var LockState;
(function (LockState) {
    LockState["Locked"] = "Locked";
    LockState["Unlocked"] = "Unlocked";
    LockState["Jammed"] = "Jammed";
})(LockState = exports.LockState || (exports.LockState = {}));
var MediaPlayerState;
(function (MediaPlayerState) {
    MediaPlayerState["Idle"] = "Idle";
    MediaPlayerState["Playing"] = "Playing";
    MediaPlayerState["Paused"] = "Paused";
    MediaPlayerState["Buffering"] = "Buffering";
})(MediaPlayerState = exports.MediaPlayerState || (exports.MediaPlayerState = {}));
var ScryptedInterface;
(function (ScryptedInterface) {
    ScryptedInterface["ScryptedDevice"] = "ScryptedDevice";
    ScryptedInterface["ScryptedPlugin"] = "ScryptedPlugin";
    ScryptedInterface["OnOff"] = "OnOff";
    ScryptedInterface["Brightness"] = "Brightness";
    ScryptedInterface["ColorSettingTemperature"] = "ColorSettingTemperature";
    ScryptedInterface["ColorSettingRgb"] = "ColorSettingRgb";
    ScryptedInterface["ColorSettingHsv"] = "ColorSettingHsv";
    ScryptedInterface["Notifier"] = "Notifier";
    ScryptedInterface["StartStop"] = "StartStop";
    ScryptedInterface["Pause"] = "Pause";
    ScryptedInterface["Dock"] = "Dock";
    ScryptedInterface["TemperatureSetting"] = "TemperatureSetting";
    ScryptedInterface["Thermometer"] = "Thermometer";
    ScryptedInterface["HumiditySensor"] = "HumiditySensor";
    ScryptedInterface["Camera"] = "Camera";
    ScryptedInterface["VideoCamera"] = "VideoCamera";
    ScryptedInterface["VideoCameraConfiguration"] = "VideoCameraConfiguration";
    ScryptedInterface["Intercom"] = "Intercom";
    ScryptedInterface["Lock"] = "Lock";
    ScryptedInterface["PasswordStore"] = "PasswordStore";
    ScryptedInterface["Authenticator"] = "Authenticator";
    ScryptedInterface["Scene"] = "Scene";
    ScryptedInterface["Entry"] = "Entry";
    ScryptedInterface["EntrySensor"] = "EntrySensor";
    ScryptedInterface["DeviceProvider"] = "DeviceProvider";
    ScryptedInterface["DeviceDiscovery"] = "DeviceDiscovery";
    ScryptedInterface["DeviceCreator"] = "DeviceCreator";
    ScryptedInterface["Battery"] = "Battery";
    ScryptedInterface["Refresh"] = "Refresh";
    ScryptedInterface["MediaPlayer"] = "MediaPlayer";
    ScryptedInterface["Online"] = "Online";
    ScryptedInterface["SoftwareUpdate"] = "SoftwareUpdate";
    ScryptedInterface["BufferConverter"] = "BufferConverter";
    ScryptedInterface["Settings"] = "Settings";
    ScryptedInterface["BinarySensor"] = "BinarySensor";
    ScryptedInterface["IntrusionSensor"] = "IntrusionSensor";
    ScryptedInterface["PowerSensor"] = "PowerSensor";
    ScryptedInterface["AudioSensor"] = "AudioSensor";
    ScryptedInterface["MotionSensor"] = "MotionSensor";
    ScryptedInterface["AmbientLightSensor"] = "AmbientLightSensor";
    ScryptedInterface["OccupancySensor"] = "OccupancySensor";
    ScryptedInterface["FloodSensor"] = "FloodSensor";
    ScryptedInterface["UltravioletSensor"] = "UltravioletSensor";
    ScryptedInterface["LuminanceSensor"] = "LuminanceSensor";
    ScryptedInterface["PositionSensor"] = "PositionSensor";
    ScryptedInterface["Readme"] = "Readme";
    ScryptedInterface["OauthClient"] = "OauthClient";
    ScryptedInterface["MixinProvider"] = "MixinProvider";
    ScryptedInterface["HttpRequestHandler"] = "HttpRequestHandler";
    ScryptedInterface["EngineIOHandler"] = "EngineIOHandler";
    ScryptedInterface["PushHandler"] = "PushHandler";
    ScryptedInterface["Program"] = "Program";
    ScryptedInterface["Scriptable"] = "Scriptable";
    ScryptedInterface["ObjectDetector"] = "ObjectDetector";
    ScryptedInterface["ObjectDetection"] = "ObjectDetection";
    ScryptedInterface["HumiditySetting"] = "HumiditySetting";
    ScryptedInterface["Fan"] = "Fan";
})(ScryptedInterface = exports.ScryptedInterface || (exports.ScryptedInterface = {}));
var ScryptedMimeTypes;
(function (ScryptedMimeTypes) {
    ScryptedMimeTypes["AcceptUrlParameter"] = "accept-url";
    ScryptedMimeTypes["Url"] = "text/x-uri";
    ScryptedMimeTypes["InsecureLocalUrl"] = "text/x-insecure-local-uri";
    ScryptedMimeTypes["LocalUrl"] = "text/x-local-uri";
    ScryptedMimeTypes["PushEndpoint"] = "text/x-push-endpoint";
    ScryptedMimeTypes["MediaStreamUrl"] = "text/x-media-url";
    ScryptedMimeTypes["FFmpegInput"] = "x-scrypted/x-ffmpeg-input";
    /**
     * An RTC Signaling endpoint will handle x-scrypted-rtc-signaling-<unique-prefix>/x-<unique-suffix>.
     * RTC clients can inspect the mime and try to convert it to an RTCAVOffer.
     * If the client does not support WebRTC, it may try to convert it to an FFmpeg media object,
     * which should also be trapped and handled by the endpoint using its internal signaling.
     * The RTC device will handle the full unique mime, and the plugin can catch all the unique prefix.
     */
    ScryptedMimeTypes["RTCAVSignalingPrefix"] = "x-scrypted-rtc-signaling-";
    ScryptedMimeTypes["RTCAVOffer"] = "x-scrypted/x-rtc-av-offer";
    ScryptedMimeTypes["RTCAVAnswer"] = "x-scrypted/x-rtc-av-answer";
    ScryptedMimeTypes["RTCAVSignalingOfferSetup"] = "x-scrypted/x-rtc-av-signalling-offer-setup";
    ScryptedMimeTypes["SchemePrefix"] = "x-scrypted/x-scrypted-scheme-";
    ScryptedMimeTypes["MediaObject"] = "x-scrypted/x-scrypted-media-object";
})(ScryptedMimeTypes = exports.ScryptedMimeTypes || (exports.ScryptedMimeTypes = {}));
//# sourceMappingURL=index.js.map