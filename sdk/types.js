"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScryptedInterfaceDescriptors = exports.SCRYPTED_MEDIA_SCHEME = exports.ScryptedMimeTypes = exports.ScryptedInterfaceProperty = exports.ScryptedInterface = exports.MediaPlayerState = exports.LockState = exports.ThermostatMode = exports.TemperatureUnit = exports.HumidityMode = exports.ScryptedDeviceType = void 0;
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
    HumidityMode["Off"] = "Off";
    HumidityMode["Humidify"] = "Humidify";
    HumidityMode["Dehumidify"] = "Dehumidify";
    HumidityMode["Auto"] = "Auto";
})(HumidityMode = exports.HumidityMode || (exports.HumidityMode = {}));
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
    ScryptedInterface["Intercom"] = "Intercom";
    ScryptedInterface["Lock"] = "Lock";
    ScryptedInterface["PasswordStore"] = "PasswordStore";
    ScryptedInterface["Authenticator"] = "Authenticator";
    ScryptedInterface["Scene"] = "Scene";
    ScryptedInterface["Entry"] = "Entry";
    ScryptedInterface["EntrySensor"] = "EntrySensor";
    ScryptedInterface["DeviceProvider"] = "DeviceProvider";
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
    ScryptedInterface["OccupancySensor"] = "OccupancySensor";
    ScryptedInterface["FloodSensor"] = "FloodSensor";
    ScryptedInterface["UltravioletSensor"] = "UltravioletSensor";
    ScryptedInterface["LuminanceSensor"] = "LuminanceSensor";
    ScryptedInterface["PositionSensor"] = "PositionSensor";
    ScryptedInterface["MediaSource"] = "MediaSource";
    ScryptedInterface["MessagingEndpoint"] = "MessagingEndpoint";
    ScryptedInterface["OauthClient"] = "OauthClient";
    ScryptedInterface["MixinProvider"] = "MixinProvider";
    ScryptedInterface["HttpRequestHandler"] = "HttpRequestHandler";
    ScryptedInterface["EngineIOHandler"] = "EngineIOHandler";
    ScryptedInterface["PushHandler"] = "PushHandler";
    ScryptedInterface["Program"] = "Program";
    ScryptedInterface["Scriptable"] = "Scriptable";
    ScryptedInterface["ObjectDetector"] = "ObjectDetector";
})(ScryptedInterface = exports.ScryptedInterface || (exports.ScryptedInterface = {}));
var ScryptedInterfaceProperty;
(function (ScryptedInterfaceProperty) {
    ScryptedInterfaceProperty["id"] = "id";
    ScryptedInterfaceProperty["interfaces"] = "interfaces";
    ScryptedInterfaceProperty["mixins"] = "mixins";
    ScryptedInterfaceProperty["info"] = "info";
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
    ScryptedInterfaceProperty["thermostatAvailableModes"] = "thermostatAvailableModes";
    ScryptedInterfaceProperty["thermostatMode"] = "thermostatMode";
    ScryptedInterfaceProperty["thermostatActiveMode"] = "thermostatActiveMode";
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
    ScryptedInterfaceProperty["motionDetected"] = "motionDetected";
    ScryptedInterfaceProperty["audioDetected"] = "audioDetected";
    ScryptedInterfaceProperty["occupied"] = "occupied";
    ScryptedInterfaceProperty["flooded"] = "flooded";
    ScryptedInterfaceProperty["ultraviolet"] = "ultraviolet";
    ScryptedInterfaceProperty["luminance"] = "luminance";
    ScryptedInterfaceProperty["position"] = "position";
})(ScryptedInterfaceProperty = exports.ScryptedInterfaceProperty || (exports.ScryptedInterfaceProperty = {}));
var ScryptedMimeTypes;
(function (ScryptedMimeTypes) {
    ScryptedMimeTypes["AcceptUrlParameter"] = "accept-url";
    ScryptedMimeTypes["Url"] = "text/x-uri";
    ScryptedMimeTypes["InsecureLocalUrl"] = "text/x-insecure-local-uri";
    ScryptedMimeTypes["LocalUrl"] = "text/x-local-uri";
    ScryptedMimeTypes["PushEndpoint"] = "text/x-push-endpoint";
    ScryptedMimeTypes["FFmpegInput"] = "x-scrypted/x-ffmpeg-input";
    ScryptedMimeTypes["RTCAVOffer"] = "x-scrypted/x-rtc-av-offer";
    ScryptedMimeTypes["RTCAVAnswer"] = "x-scrypted/x-rtc-av-answer";
})(ScryptedMimeTypes = exports.ScryptedMimeTypes || (exports.ScryptedMimeTypes = {}));
exports.SCRYPTED_MEDIA_SCHEME = 'scryped-media://';
exports.ScryptedInterfaceDescriptors = {
    ScryptedDevice: {
        name: "ScryptedDevice",
        properties: [
            "id",
            "interfaces",
            "mixins",
            "info",
            "name",
            "providedInterfaces",
            "providedName",
            "providedRoom",
            "providedType",
            "providerId",
            "room",
            "type",
        ],
        methods: [
            "listen",
            "setName",
            "setRoom",
            "setType",
        ]
    },
    OnOff: {
        name: "OnOff",
        properties: [
            "on",
        ],
        methods: [
            "turnOff",
            "turnOn",
        ]
    },
    Brightness: {
        name: "Brightness",
        properties: [
            "brightness",
        ],
        methods: [
            "setBrightness",
        ]
    },
    ColorSettingTemperature: {
        name: "ColorSettingTemperature",
        properties: [
            "colorTemperature",
        ],
        methods: [
            "getTemperatureMaxK",
            "getTemperatureMinK",
            "setColorTemperature",
        ]
    },
    ColorSettingRgb: {
        name: "ColorSettingRgb",
        properties: [
            "rgb",
        ],
        methods: [
            "setRgb",
        ]
    },
    ColorSettingHsv: {
        name: "ColorSettingHsv",
        properties: [
            "hsv",
        ],
        methods: [
            "setHsv",
        ]
    },
    Notifier: {
        name: "Notifier",
        properties: [],
        methods: [
            "sendNotification",
        ]
    },
    StartStop: {
        name: "StartStop",
        properties: [
            "running",
        ],
        methods: [
            "start",
            "stop",
        ]
    },
    Pause: {
        name: "Pause",
        properties: [
            "paused",
        ],
        methods: [
            "pause",
            "resume",
        ]
    },
    Dock: {
        name: "Dock",
        properties: [
            "docked",
        ],
        methods: [
            "dock",
        ]
    },
    TemperatureSetting: {
        name: "TemperatureSetting",
        properties: [
            "thermostatAvailableModes",
            "thermostatMode",
            "thermostatActiveMode",
            "thermostatSetpoint",
            "thermostatSetpointHigh",
            "thermostatSetpointLow",
        ],
        methods: [
            "setThermostatMode",
            "setThermostatSetpoint",
            "setThermostatSetpointHigh",
            "setThermostatSetpointLow",
        ]
    },
    Thermometer: {
        name: "Thermometer",
        properties: [
            "temperature",
            "temperatureUnit",
        ],
        methods: []
    },
    HumiditySensor: {
        name: "HumiditySensor",
        properties: [
            "humidity",
        ],
        methods: []
    },
    Camera: {
        name: "Camera",
        properties: [],
        methods: [
            "takePicture",
        ]
    },
    VideoCamera: {
        name: "VideoCamera",
        properties: [],
        methods: [
            "getVideoStream",
            "getVideoStreamOptions",
        ]
    },
    Intercom: {
        name: "Intercom",
        properties: [],
        methods: [
            "startIntercom",
            "stopIntercom",
        ]
    },
    Lock: {
        name: "Lock",
        properties: [
            "lockState",
        ],
        methods: [
            "lock",
            "unlock",
        ]
    },
    PasswordStore: {
        name: "PasswordStore",
        properties: [],
        methods: [
            "addPassword",
            "getPasswords",
            "removePassword",
        ]
    },
    Authenticator: {
        name: "Authenticator",
        properties: [],
        methods: [
            "checkPassword",
        ]
    },
    Scene: {
        name: "Scene",
        properties: [],
        methods: [
            "activate",
            "deactivate",
            "isReversible",
        ]
    },
    Entry: {
        name: "Entry",
        properties: [],
        methods: [
            "closeEntry",
            "openEntry",
        ]
    },
    EntrySensor: {
        name: "EntrySensor",
        properties: [
            "entryOpen",
        ],
        methods: []
    },
    DeviceProvider: {
        name: "DeviceProvider",
        properties: [],
        methods: [
            "discoverDevices",
            "getDevice",
        ]
    },
    Battery: {
        name: "Battery",
        properties: [
            "batteryLevel",
        ],
        methods: []
    },
    Refresh: {
        name: "Refresh",
        properties: [],
        methods: [
            "getRefreshFrequency",
            "refresh",
        ]
    },
    MediaPlayer: {
        name: "MediaPlayer",
        properties: [],
        methods: [
            "getMediaStatus",
            "load",
            "seek",
            "skipNext",
            "skipPrevious",
        ]
    },
    Online: {
        name: "Online",
        properties: [
            "online",
        ],
        methods: []
    },
    SoftwareUpdate: {
        name: "SoftwareUpdate",
        properties: [
            "updateAvailable",
        ],
        methods: [
            "checkForUpdate",
            "installUpdate",
        ]
    },
    BufferConverter: {
        name: "BufferConverter",
        properties: [
            "fromMimeType",
            "toMimeType",
        ],
        methods: [
            "convert",
        ]
    },
    Settings: {
        name: "Settings",
        properties: [],
        methods: [
            "getSettings",
            "putSetting",
        ]
    },
    BinarySensor: {
        name: "BinarySensor",
        properties: [
            "binaryState",
        ],
        methods: []
    },
    IntrusionSensor: {
        name: "IntrusionSensor",
        properties: [
            "intrusionDetected",
        ],
        methods: []
    },
    PowerSensor: {
        name: "PowerSensor",
        properties: [
            "powerDetected",
        ],
        methods: []
    },
    AudioSensor: {
        name: "AudioSensor",
        properties: [
            "audioDetected",
        ],
        methods: []
    },
    MotionSensor: {
        name: "MotionSensor",
        properties: [
            "motionDetected",
        ],
        methods: []
    },
    OccupancySensor: {
        name: "OccupancySensor",
        properties: [
            "occupied",
        ],
        methods: []
    },
    FloodSensor: {
        name: "FloodSensor",
        properties: [
            "flooded",
        ],
        methods: []
    },
    UltravioletSensor: {
        name: "UltravioletSensor",
        properties: [
            "ultraviolet",
        ],
        methods: []
    },
    LuminanceSensor: {
        name: "LuminanceSensor",
        properties: [
            "luminance",
        ],
        methods: []
    },
    PositionSensor: {
        name: "PositionSensor",
        properties: [
            "position",
        ],
        methods: []
    },
    MediaSource: {
        name: "MediaSource",
        properties: [],
        methods: [
            "getMedia",
        ]
    },
    MessagingEndpoint: {
        name: "MessagingEndpoint",
        properties: [],
        methods: []
    },
    OauthClient: {
        name: "OauthClient",
        properties: [],
        methods: [
            "getOauthUrl",
            "onOauthCallback",
        ]
    },
    MixinProvider: {
        name: "MixinProvider",
        properties: [],
        methods: [
            "canMixin",
            "getMixin",
            "releaseMixin",
        ]
    },
    HttpRequestHandler: {
        name: "HttpRequestHandler",
        properties: [],
        methods: [
            "onRequest",
        ]
    },
    EngineIOHandler: {
        name: "EngineIOHandler",
        properties: [],
        methods: [
            "onConnection",
        ]
    },
    PushHandler: {
        name: "PushHandler",
        properties: [],
        methods: [
            "onPush",
        ]
    },
    Program: {
        name: "Program",
        properties: [],
        methods: [
            "run",
        ]
    },
    Scriptable: {
        name: "Scriptable",
        properties: [],
        methods: [
            "saveScript",
            "loadScripts",
            "eval",
        ]
    },
    ObjectDetector: {
        name: "ObjectDetector",
        properties: [],
        methods: [
            "getDetectionInput",
            "getObjectTypes",
        ]
    },
    HumiditySetting: {
        name: "HumiditySetting",
        properties: [
            "humiditySetting",
        ],
        methods: [
            "setHumidity",
        ]
    },
    Fan: {
        name: "Fan",
        properties: [
            "fan",
        ],
        methods: [
            "setFanSpeed",
        ],
    }
};
//# sourceMappingURL=types.js.map